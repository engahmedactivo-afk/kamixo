import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { AdsModule } from './ads/ads.module';
import { AdsService } from './ads/ads.module';
import { AuthUser, CurrentUser, UserAuthGuard } from './auth/auth.guards';
import { PrismaService } from './common/prisma.service';
import { SubscriptionsService } from './subscriptions/subscriptions.service';
import { WalletModule } from './wallet/wallet.module';
import { WalletService } from './wallet/wallet.service';

/** One call the app makes at startup for everything about the current user. */
@Controller('me')
@UseGuards(UserAuthGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly subs: SubscriptionsService,
    private readonly ads: AdsService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const [u, balance, vip, ads, purchases] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, locale: true, createdAt: true } }),
      this.wallet.balance(user.id),
      this.subs.status(user.id),
      this.ads.usage(user.id),
      this.prisma.purchase.count({ where: { userId: user.id } }),
    ]);
    return { ...u, balance, vip, ads, hasPurchased: purchases > 0 };
  }
}

@Module({ imports: [WalletModule, AdsModule], controllers: [MeController] })
export class MeModule {}
