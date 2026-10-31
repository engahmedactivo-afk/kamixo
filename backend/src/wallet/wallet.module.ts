import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { config } from '../config';
import { PlaybackModule } from '../playback/playback.module';
import { PURCHASE_VERIFIER, RevenueCatPurchaseVerifier, SandboxPurchaseVerifier } from './purchase-verifier';
import { WalletService } from './wallet.service';

export class PurchaseDto {
  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';

  @IsString()
  @Length(1, 100)
  productId: string;

  @IsString()
  @Length(1, 200)
  transactionId: string;
}

@Controller()
@UseGuards(UserAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('wallet')
  summary(@CurrentUser() user: AuthUser) {
    return this.wallet.summary(user.id);
  }

  @Get('coin-packs')
  packs() {
    return this.wallet.coinPacks();
  }

  @Post('wallet/purchases')
  purchase(@CurrentUser() user: AuthUser, @Body() dto: PurchaseDto) {
    return this.wallet.creditPurchase({ userId: user.id, ...dto });
  }

  @Post('episodes/:id/unlock')
  unlock(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.unlockWithCoins(user.id, id);
  }
}

@Module({
  imports: [PlaybackModule],
  controllers: [WalletController],
  providers: [
    WalletService,
    {
      provide: PURCHASE_VERIFIER,
      useFactory: () =>
        config.purchaseVerifier === 'revenuecat' ? new RevenueCatPurchaseVerifier() : new SandboxPurchaseVerifier(),
    },
  ],
})
export class WalletModule {}
