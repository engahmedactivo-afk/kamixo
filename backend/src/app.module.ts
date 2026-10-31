import { Controller, Get, Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AdsModule } from './ads/ads.module';
import { MeModule } from './me.module';
import { PushModule } from './push/push.module';
import { RemoteConfigModule } from './remote-config/remote-config.module';
import { RewardsModule } from './rewards/rewards.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { WebhooksModule } from './webhooks/revenuecat.webhook';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { PrismaModule } from './common/prisma.service';
import { PlaybackModule } from './playback/playback.module';
import { ProgressModule } from './progress/progress.module';
import { WalletModule } from './wallet/wallet.module';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return { ok: true };
  }
}

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PlaybackModule,
    CatalogModule,
    WalletModule,
    ProgressModule,
    AnalyticsModule,
    AdminModule,
    SubscriptionsModule,
    PushModule,
    AdsModule,
    RewardsModule,
    RemoteConfigModule,
    WebhooksModule,
    MeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
