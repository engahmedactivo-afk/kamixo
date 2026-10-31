import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { Prisma } from '@prisma/client';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AdminKeyGuard } from '../auth/auth.guards';
import { PrismaService } from '../common/prisma.service';
import { PushService } from '../push/push.service';
import { RemoteConfigModule, RemoteConfigService } from '../remote-config/remote-config.module';

export class CreateSeriesDto {
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @IsUrl() coverUrl: string;
  @IsString({ each: true }) @ArrayMaxSize(10) genres: string[];
  @IsInt() @Min(0) @Max(1000) freeEpisodes: number;
  @IsInt() @Min(1) @Max(100000) coinsPerEpisode: number;
}
export class UpdateSeriesDto extends PartialType(CreateSeriesDto) {
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
}

export class CreateEpisodeDto {
  @IsInt() @Min(1) @Max(10000) number: number;
  @IsOptional() @IsString() @Length(0, 200) title?: string;
  @IsInt() @Min(0) @Max(86400) durationSec: number;
  @IsUrl() hlsUrl: string;
  /** {"en": "https://.../ep1.en.vtt"} */
  @IsOptional() @IsObject() subtitles?: Record<string, string>;
}
export class UpdateEpisodeDto extends PartialType(CreateEpisodeDto) {}

export class CoinPackDto {
  @IsString() @Length(1, 100) productId: string;
  @IsInt() @Min(1) coins: number;
  @IsOptional() @IsInt() @Min(0) bonusCoins?: number;
  @IsString() @Length(1, 30) priceLabel: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
export class UpdateCoinPackDto extends PartialType(CoinPackDto) {}

export class VipPlanDto {
  @IsString() @Length(1, 100) productId: string;
  @IsString() @Length(1, 60) name: string;
  @IsInt() @Min(1) @Max(366) days: number;
  @IsString() @Length(1, 30) priceLabel: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
export class UpdateVipPlanDto extends PartialType(VipPlanDto) {}

export class PushBroadcastDto {
  @IsString() @Length(1, 80) title: string;
  @IsString() @Length(1, 200) body: string;
  /** Optional: tap opens this series */
  @IsOptional() @IsString() @Length(36, 36) seriesId?: string;
  /** "all" or "series" (only users who started seriesId) */
  @IsOptional() @IsIn(['all', 'series']) audience?: 'all' | 'series';
}

export class RemoteConfigDto {
  @IsOptional() @IsInt() @Min(0) @Max(500) firstPurchaseBonusPct?: number;
  @IsOptional() @IsIn(['coins', 'vip']) paywallPrimary?: 'coins' | 'vip';
  @IsOptional() @IsObject() experiments?: Record<string, string[]>;
}

function validSubtitles(subs: Record<string, string> | undefined) {
  if (!subs) return undefined;
  for (const [lang, url] of Object.entries(subs)) {
    if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(lang) || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new BadRequestException(`Invalid subtitle entry "${lang}"`);
    }
  }
  return subs as Prisma.InputJsonValue;
}

async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      throw new NotFoundException();
    }
    throw e;
  }
}

@Controller('admin')
@UseGuards(AdminKeyGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly remoteConfig: RemoteConfigService,
  ) {}

  @Get('stats')
  async stats() {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [users, series, purchases24h, revenueCoins24h, unlocks24h, activeVip, adUnlocks24h, pushTokens] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.series.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.purchase.count({ where: { createdAt: { gte: since } } }),
      this.prisma.purchase.aggregate({ where: { createdAt: { gte: since } }, _sum: { coins: true } }),
      this.prisma.unlock.count({ where: { createdAt: { gte: since } } }),
      this.prisma.subscription.count({ where: { expiresAt: { gt: new Date() } } }),
      this.prisma.adReward.count({ where: { createdAt: { gte: since } } }),
      this.prisma.pushToken.count(),
    ]);
    return {
      users,
      publishedSeries: series,
      purchases24h,
      coinsSold24h: revenueCoins24h._sum.coins ?? 0,
      unlocks24h,
      activeVip,
      adUnlocks24h,
      pushTokens,
      pushEnabled: this.push.enabled,
    };
  }

  // ---- Series ----
  @Get('series')
  listSeries() {
    return this.prisma.series.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { episodes: true } } },
    });
  }

  @Get('series/:id')
  async getSeries(@Param('id', ParseUUIDPipe) id: string) {
    const s = await this.prisma.series.findUnique({
      where: { id },
      include: { episodes: { orderBy: { number: 'asc' } } },
    });
    if (!s) throw new NotFoundException();
    return s;
  }

  @Post('series')
  createSeries(@Body() dto: CreateSeriesDto) {
    return this.prisma.series.create({ data: { ...dto, description: dto.description ?? '' } });
  }

  @Patch('series/:id')
  async updateSeries(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSeriesDto) {
    const current = await this.prisma.series.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    const publishing = dto.status === 'PUBLISHED' && !current.publishedAt;
    return this.prisma.series.update({
      where: { id },
      data: { ...dto, ...(publishing && { publishedAt: new Date() }) },
    });
  }

  @Delete('series/:id')
  @HttpCode(204)
  async deleteSeries(@Param('id', ParseUUIDPipe) id: string) {
    await orNotFound(this.prisma.series.delete({ where: { id } }));
  }

  // ---- Episodes ----
  @Post('series/:id/episodes')
  async createEpisode(@Param('id', ParseUUIDPipe) seriesId: string, @Body() dto: CreateEpisodeDto) {
    const episode = await orNotFound(
      this.prisma.series.update({
        where: { id: seriesId },
        data: {
          episodes: {
            create: { ...dto, title: dto.title ?? '', subtitles: validSubtitles(dto.subtitles) ?? {} },
          },
        },
        select: { title: true, status: true, episodes: { where: { number: dto.number } } },
      }),
    );
    if (episode.status === 'PUBLISHED') {
      // "New episode" push to everyone who started this series. Fire-and-forget.
      void this.notifySeriesWatchers(seriesId, {
        title: episode.title,
        body: `Episode ${dto.number} is out now`,
        data: { seriesId, episode: String(dto.number) },
      }).catch(() => undefined);
    }
    return episode.episodes[0];
  }

  private async notifySeriesWatchers(seriesId: string, msg: { title: string; body: string; data: Record<string, string> }) {
    const watchers = await this.prisma.watchProgress.findMany({ where: { seriesId }, select: { userId: true } });
    return this.push.sendToUsers(watchers.map((w) => w.userId), msg);
  }

  @Patch('episodes/:id')
  updateEpisode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEpisodeDto) {
    return orNotFound(
      this.prisma.episode.update({
        where: { id },
        data: { ...dto, subtitles: validSubtitles(dto.subtitles) },
      }),
    );
  }

  @Delete('episodes/:id')
  @HttpCode(204)
  async deleteEpisode(@Param('id', ParseUUIDPipe) id: string) {
    await orNotFound(this.prisma.episode.delete({ where: { id } }));
  }

  // ---- Coin packs ----
  @Get('coin-packs')
  listPacks() {
    return this.prisma.coinPack.findMany({ orderBy: [{ sortOrder: 'asc' }, { coins: 'asc' }] });
  }

  @Post('coin-packs')
  createPack(@Body() dto: CoinPackDto) {
    return this.prisma.coinPack.create({ data: dto });
  }

  @Patch('coin-packs/:id')
  updatePack(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCoinPackDto) {
    return orNotFound(this.prisma.coinPack.update({ where: { id }, data: dto }));
  }

  // ---- VIP plans ----
  @Get('vip-plans')
  listVipPlans() {
    return this.prisma.vipPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { days: 'asc' }] });
  }

  @Post('vip-plans')
  createVipPlan(@Body() dto: VipPlanDto) {
    return this.prisma.vipPlan.create({ data: dto });
  }

  @Patch('vip-plans/:id')
  updateVipPlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVipPlanDto) {
    return orNotFound(this.prisma.vipPlan.update({ where: { id }, data: dto }));
  }

  // ---- Push notifications ----
  @Post('push')
  async broadcast(@Body() dto: PushBroadcastDto) {
    const data: Record<string, string> = dto.seriesId ? { seriesId: dto.seriesId } : {};
    const msg = { title: dto.title, body: dto.body, data };
    if (dto.audience === 'series') {
      if (!dto.seriesId) throw new BadRequestException('seriesId is required for audience "series"');
      return this.notifySeriesWatchers(dto.seriesId, msg);
    }
    return this.push.sendToAll(msg);
  }

  /**
   * "Come back" reminders: users who last watched 1–3 days ago get a nudge to resume.
   * Call it from a daily cron (e.g. curl -X POST -H "x-admin-key: ..." /admin/push/reminders).
   */
  @Post('push/reminders')
  async reminders() {
    const now = Date.now();
    const rows = await this.prisma.watchProgress.findMany({
      where: { updatedAt: { gte: new Date(now - 3 * 86400000), lt: new Date(now - 86400000) }, series: { status: 'PUBLISHED' } },
      orderBy: { updatedAt: 'desc' },
      distinct: ['userId'],
      include: { series: { select: { title: true } } },
    });
    let sent = 0;
    for (const r of rows) {
      const res = await this.push.sendToUsers([r.userId], {
        title: r.series.title,
        body: `You stopped at episode ${r.episodeNumber}. Keep watching?`,
        data: { seriesId: r.seriesId, episode: String(r.episodeNumber) },
      });
      sent += res.sent;
    }
    return { candidates: rows.length, sent };
  }

  // ---- Remote config ----
  @Get('settings/config')
  getConfig() {
    return this.remoteConfig.get();
  }

  @Patch('settings/config')
  setConfig(@Body() dto: RemoteConfigDto) {
    return this.remoteConfig.set(dto);
  }
}

@Module({ imports: [RemoteConfigModule], controllers: [AdminController] })
export class AdminModule {}
