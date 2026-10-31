import { Body, Controller, Global, HttpCode, Module, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { PushService } from './push.service';

export class PushTokenDto {
  @IsString()
  @Length(10, 4096)
  token: string;

  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';
}

@Controller('me')
@UseGuards(UserAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('push-token')
  @HttpCode(204)
  async register(@CurrentUser() user: AuthUser, @Body() dto: PushTokenDto) {
    await this.push.register(user.id, dto.token, dto.platform);
  }
}

@Global()
@Module({ controllers: [PushController], providers: [PushService], exports: [PushService] })
export class PushModule {}
