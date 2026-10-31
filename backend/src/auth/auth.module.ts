import { Body, Controller, Global, Injectable, Module, Post } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { AdminKeyGuard, UserAuthGuard } from './auth.guards';

export class GuestLoginDto {
  /** Random id generated once by the app and kept in secure storage. Acts as the guest credential. */
  @IsString()
  @Length(16, 128)
  deviceId: string;

  @IsOptional()
  @Matches(/^[a-z]{2}(-[A-Za-z]{2})?$/)
  locale?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  country?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async guestLogin(dto: GuestLoginDto) {
    const user = await this.prisma.user.upsert({
      where: { deviceId: dto.deviceId },
      create: { deviceId: dto.deviceId, locale: dto.locale ?? 'en', country: dto.country },
      update: { ...(dto.locale && { locale: dto.locale }), ...(dto.country && { country: dto.country }) },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id },
      { secret: config.jwtSecret, expiresIn: '30d' },
    );
    return { accessToken, user: { id: user.id, locale: user.locale } };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  guest(@Body() dto: GuestLoginDto) {
    return this.auth.guestLogin(dto);
  }
}

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, UserAuthGuard, AdminKeyGuard],
  exports: [JwtModule, UserAuthGuard, AdminKeyGuard],
})
export class AuthModule {}
