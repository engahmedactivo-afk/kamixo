import { Body, Controller, Headers, HttpCode, HttpStatus, Injectable, Logger, Module, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WalletModule } from '../wallet/wallet.module';
import { WalletService } from '../wallet/wallet.service';
import { StripeClient } from './stripe.client';

export class CheckoutDto {
  @IsIn(['coins', 'vip'])
  kind: 'coins' | 'vip';

  @IsString()
  @Length(1, 100)
  productId: string;
}

/**
 * Web payments through Stripe Checkout: no app-store fee. VIP bought on the web is a fixed-length pass
 * (the plan's `days`), not an auto-renewing subscription, to keep the web flow simple.
 * Never link to this from inside the iOS/Android apps: store rules require in-app purchases there.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly subs: SubscriptionsService,
    private readonly stripe: StripeClient,
  ) {}

  async checkout(userId: string, dto: CheckoutDto) {
    const item =
      dto.kind === 'coins'
        ? await this.prisma.coinPack.findFirst({ where: { productId: dto.productId, active: true } })
        : await this.prisma.vipPlan.findFirst({ where: { productId: dto.productId, active: true } });
    if (!item) throw new AppError(HttpStatus.BAD_REQUEST, 'UNKNOWN_PRODUCT', 'Unknown product');
    if (item.priceCents <= 0) throw new AppError(HttpStatus.BAD_REQUEST, 'NO_WEB_PRICE', 'This product is not sold on the web');
    const name = dto.kind === 'coins' ? `${(item as { coins: number }).coins} Kamixo coins` : `Kamixo ${(item as { name: string }).name}`;
    const metadata = { userId, kind: dto.kind, productId: dto.productId };

    if (!config.stripeSecretKey) {
      // Sandbox: complete the order immediately.
      await this.fulfil(metadata, `sandbox-${randomUUID()}`);
      return { sandbox: true, url: null };
    }
    const session = await this.stripe.createCheckoutSession({
      name,
      amountCents: item.priceCents,
      successUrl: `${config.publicBaseUrl}/web/?paid=1`,
      cancelUrl: `${config.publicBaseUrl}/web/?cancelled=1`,
      metadata,
    });
    return { sandbox: false, url: session.url };
  }

  /** Applies a paid order. Idempotent on the Stripe session / payment id. */
  async fulfil(meta: { userId: string; kind: string; productId: string }, paymentId: string) {
    if (meta.kind === 'coins') {
      await this.wallet.creditPurchase({ userId: meta.userId, platform: 'android', productId: meta.productId, transactionId: `stripe:${paymentId}` }, true);
    } else if (meta.kind === 'vip') {
      const plan = await this.prisma.vipPlan.findUnique({ where: { productId: meta.productId } });
      if (!plan) throw new Error(`Unknown VIP plan ${meta.productId}`);
      const existing = await this.prisma.subscription.findUnique({ where: { userId: meta.userId } });
      if (existing?.lastEventId === `stripe:${paymentId}`) return;
      // Extend from the current expiry when still active, so buying twice stacks.
      const base = existing && existing.expiresAt > new Date() ? existing.expiresAt : new Date();
      await this.subs.apply(meta.userId, {
        productId: plan.productId,
        store: 'stripe',
        expiresAt: new Date(base.getTime() + plan.days * 86400000),
        willRenew: false,
        eventId: `stripe:${paymentId}`,
      });
    }
    this.log.log(`Fulfilled web order ${paymentId} (${meta.kind} ${meta.productId}) for ${meta.userId}`);
  }
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('web/checkout')
  @UseGuards(UserAuthGuard)
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.payments.checkout(user.id, dto);
  }

  /** Stripe webhook: configure checkout.session.completed to <PUBLIC_BASE_URL>/webhooks/stripe. */
  @Post('webhooks/stripe')
  @HttpCode(200)
  async stripe(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') sig: string | undefined) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (!StripeClient.verifySignature(raw, sig, config.stripeWebhookSecret)) throw new UnauthorizedException('Bad signature');
    const event = JSON.parse(raw) as { type: string; data: { object: { id: string; payment_status?: string; metadata?: Record<string, string> } } };
    if (event.type !== 'checkout.session.completed') return { ok: true, ignored: event.type };
    const s = event.data.object;
    const m = s.metadata ?? {};
    if (s.payment_status && s.payment_status !== 'paid') return { ok: true, ignored: s.payment_status };
    if (!m.userId || !m.kind || !m.productId) return { ok: true, ignored: 'no metadata' };
    await this.payments.fulfil({ userId: m.userId, kind: m.kind, productId: m.productId }, s.id);
    return { ok: true };
  }
}

@Module({ imports: [WalletModule], controllers: [PaymentsController], providers: [PaymentsService, StripeClient] })
export class PaymentsModule {}
