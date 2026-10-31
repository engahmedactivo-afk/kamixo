import { Body, Controller, Headers, HttpCode, Logger, Module, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WalletModule } from '../wallet/wallet.module';
import { WalletService } from '../wallet/wallet.service';

/** Subset of the RevenueCat webhook event we use. https://www.revenuecat.com/docs/integrations/webhooks */
interface RcEvent {
  id: string;
  type: string;
  app_user_id: string;
  product_id: string;
  store?: string;
  transaction_id?: string;
  expiration_at_ms?: number | null;
  period_type?: string;
}

const SUBSCRIPTION_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'CANCELLATION',
  'UNCANCELLATION',
  'BILLING_ISSUE',
  'EXPIRATION',
  'SUBSCRIPTION_EXTENDED',
]);

/**
 * RevenueCat calls this for every purchase event. It makes the backend robust:
 * coins and VIP are applied even if the app never reached /wallet/purchases or /subscriptions/sync.
 * Configure in RevenueCat: URL <PUBLIC_BASE_URL>/webhooks/revenuecat, Authorization header = REVENUECAT_WEBHOOK_SECRET.
 */
@Controller('webhooks/revenuecat')
export class RevenueCatWebhookController {
  private readonly log = new Logger(RevenueCatWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly subs: SubscriptionsService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Headers('authorization') auth: string | undefined, @Body() body: { event?: RcEvent }) {
    const secret = config.revenueCatWebhookSecret;
    const provided = Buffer.from(auth ?? '');
    const expected = Buffer.from(secret);
    if (!secret || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedException();
    }
    const ev = body.event;
    if (!ev?.app_user_id || !ev.product_id) return { ok: true, ignored: 'no event' };

    const user = await this.prisma.user.findUnique({ where: { id: ev.app_user_id }, select: { id: true } });
    if (!user) return { ok: true, ignored: 'unknown user' };

    // Consumable coin packs arrive as NON_RENEWING_PURCHASE.
    const pack = await this.prisma.coinPack.findUnique({ where: { productId: ev.product_id } });
    if (pack && ev.transaction_id) {
      await this.wallet.creditPurchase(
        { userId: user.id, platform: ev.store === 'APP_STORE' ? 'ios' : 'android', productId: pack.productId, transactionId: ev.transaction_id },
        true,
      );
      return { ok: true, credited: pack.productId };
    }

    if (SUBSCRIPTION_EVENTS.has(ev.type) && ev.expiration_at_ms) {
      const plan = await this.prisma.vipPlan.findUnique({ where: { productId: ev.product_id } });
      if (!plan) return { ok: true, ignored: 'unknown product' };
      await this.subs.apply(user.id, {
        productId: ev.product_id,
        store: ev.store,
        expiresAt: new Date(ev.expiration_at_ms),
        willRenew: !['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE'].includes(ev.type),
        eventId: ev.id,
      });
      return { ok: true, subscription: ev.type };
    }
    this.log.log(`Ignored RevenueCat event ${ev.type} for ${ev.product_id}`);
    return { ok: true, ignored: ev.type };
  }
}

@Module({ imports: [WalletModule], controllers: [RevenueCatWebhookController] })
export class WebhooksModule {}
