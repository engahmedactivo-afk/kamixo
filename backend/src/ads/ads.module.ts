import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Injectable,
  Logger,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString, Length } from 'class-validator';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { PlaybackModule } from '../playback/playback.module';
import { PlaybackService } from '../playback/playback.service';
import { startOfUtcDay } from '../wallet/wallet.service';
import { AdMobSsvVerifier } from './admob-ssv';

export class AdUnlockDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  transactionId?: string;
}

@Injectable()
export class AdsService {
  private readonly log = new Logger(AdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: PlaybackService,
    private readonly ssv: AdMobSsvVerifier,
  ) {}

  async usage(userId: string) {
    const used = await this.prisma.adReward.count({ where: { userId, createdAt: { gte: startOfUtcDay() } } });
    return { cap: config.adUnlockDailyCap, usedToday: used, remainingToday: Math.max(config.adUnlockDailyCap - used, 0) };
  }

  /**
   * Records one rewarded-ad completion and unlocks the episode. Idempotent per transactionId.
   * Throws AD_LIMIT_REACHED when the user is over the daily cap.
   */
  async grant(userId: string, episodeId: string, transactionId: string) {
    const ep = await this.playback.findPublishedEpisode(episodeId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const dup = await tx.adReward.findUnique({ where: { transactionId } });
      if (dup) return { unlocked: true, duplicate: true };
      const used = await tx.adReward.count({ where: { userId, createdAt: { gte: startOfUtcDay() } } });
      if (used >= config.adUnlockDailyCap) {
        throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'AD_LIMIT_REACHED', 'Daily ad unlock limit reached', {
          cap: config.adUnlockDailyCap,
        });
      }
      await tx.adReward.create({ data: { userId, episodeId: ep.id, transactionId } });
      await tx.unlock.upsert({
        where: { userId_episodeId: { userId, episodeId: ep.id } },
        create: { userId, episodeId: ep.id, method: 'AD' },
        update: {},
      });
      return { unlocked: true, duplicate: false };
    });
  }

  /** App-reported completion. Only trusted in sandbox mode; with AdMob the SSV callback is the source of truth. */
  async unlockFromClient(userId: string, episodeId: string, transactionId?: string) {
    if (config.adRewardVerifier !== 'sandbox') {
      throw new AppError(HttpStatus.BAD_REQUEST, 'SSV_REQUIRED', 'Ad rewards are granted by server-side verification');
    }
    return this.grant(userId, episodeId, transactionId ?? `sandbox-${randomUUID()}`);
  }

  /** AdMob SSV callback. custom_data is "<userId>:<episodeId>", set by the app before showing the ad. */
  async handleSsv(rawQuery: string): Promise<boolean> {
    let cb: Awaited<ReturnType<AdMobSsvVerifier['verify']>> = null;
    try {
      cb = await this.ssv.verify(rawQuery);
    } catch (e) {
      this.log.error(`AdMob SSV verification failed: ${(e as Error).message}`);
      return false;
    }
    if (!cb) {
      this.log.warn('Rejected AdMob SSV callback with bad signature');
      return false;
    }
    const [userId, episodeId] = cb.customData.split(':');
    if (!userId || !episodeId) return false;
    try {
      await this.grant(userId, episodeId, cb.transactionId);
    } catch (e) {
      if (e instanceof AppError || e instanceof Prisma.PrismaClientKnownRequestError) {
        this.log.warn(`SSV reward not granted for ${userId}/${episodeId}: ${e.message}`);
        return false;
      }
      throw e;
    }
    return true;
  }
}

@Controller()
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get('ads/usage')
  @UseGuards(UserAuthGuard)
  usage(@CurrentUser() user: AuthUser) {
    return this.ads.usage(user.id);
  }

  @Post('episodes/:id/unlock-with-ad')
  @UseGuards(UserAuthGuard)
  unlock(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdUnlockDto) {
    return this.ads.unlockFromClient(user.id, id, dto.transactionId);
  }

  /** Configure this URL in AdMob: <PUBLIC_BASE_URL>/webhooks/admob/ssv */
  @Get('webhooks/admob/ssv')
  async ssv(@Req() req: Request, @Query('signature') _sig: string) {
    const raw = req.url.split('?')[1] ?? '';
    const ok = await this.ads.handleSsv(raw);
    // AdMob retries on non-2xx; a bad signature is final, so answer 200 either way.
    return { ok };
  }
}

@Module({
  imports: [PlaybackModule],
  controllers: [AdsController],
  providers: [AdsService, AdMobSsvVerifier],
  exports: [AdsService],
})
export class AdsModule {}
