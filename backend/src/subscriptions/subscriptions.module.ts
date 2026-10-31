import { Body, Controller, Get, Global, Module, Post, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { RevenueCatClient } from '../common/revenuecat.client';
import { SubscriptionsService } from './subscriptions.service';

export class SyncSubscriptionDto {
  @IsString()
  @Length(1, 100)
  productId: string;
}

@Controller('subscriptions')
@UseGuards(UserAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('plans')
  plans() {
    return this.subs.plans();
  }

  @Get('me')
  status(@CurrentUser() user: AuthUser) {
    return this.subs.status(user.id);
  }

  @Post('sync')
  sync(@CurrentUser() user: AuthUser, @Body() dto: SyncSubscriptionDto) {
    return this.subs.sync(user.id, dto.productId);
  }
}

@Global()
@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, RevenueCatClient],
  exports: [SubscriptionsService, RevenueCatClient],
})
export class SubscriptionsModule {}
