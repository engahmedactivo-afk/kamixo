import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Studio } from '@prisma/client';
import { ArrayMaxSize, IsInt, IsOptional, IsString, IsUrl, Length, Matches, Max, Min } from 'class-validator';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { JobsService } from '../media/jobs.service';
import { MediaService } from '../media/media.module';
import { videoUpload } from '../media/upload';

@Injectable()
export class StudioKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const key = String(req.headers['x-studio-key'] ?? '');
    if (key.length < 16) throw new UnauthorizedException('Invalid studio key');
    const studio = await this.prisma.studio.findUnique({ where: { apiKey: key } });
    if (!studio) throw new UnauthorizedException('Invalid studio key');
    req.studio = studio;
    return true;
  }
}

export const CurrentStudio = createParamDecorator((_: unknown, ctx: ExecutionContext): Studio => ctx.switchToHttp().getRequest().studio);

export class StudioSeriesDto {
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @IsUrl() coverUrl: string;
  @IsString({ each: true }) @ArrayMaxSize(10) genres: string[];
  @IsOptional() @Matches(/^[a-z]{2}$/) sourceLang?: string;
}

export class UploadEpisodeDto {
  @IsInt() @Min(1) @Max(10000) number: number;
  @IsOptional() @IsString() @Length(0, 200) title?: string;
}

function monthRange(month: string | undefined): { from: Date; to: Date; label: string } {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  return { from: new Date(Date.UTC(y, mo - 1, 1)), to: new Date(Date.UTC(y, mo, 1)), label: m };
}

/** Self-service portal for content partners: upload series, follow processing, see earnings. */
@Controller('studio')
@UseGuards(StudioKeyGuard)
export class StudioController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly jobsService: JobsService,
  ) {}

  @Get('me')
  me(@CurrentStudio() studio: Studio) {
    return { id: studio.id, name: studio.name, email: studio.email, revenueSharePct: studio.revenueSharePct };
  }

  @Get('series')
  async series(@CurrentStudio() studio: Studio) {
    const rows = await this.prisma.series.findMany({
      where: { studioId: studio.id },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { episodes: true } }, episodes: { select: { id: true, number: true, hlsUrl: true, subtitles: true, dubs: true }, orderBy: { number: 'asc' } } },
    });
    const unlocks = await this.prisma.unlock.groupBy({
      by: ['episodeId'],
      where: { method: 'COINS', episode: { series: { studioId: studio.id } } },
      _sum: { coinsSpent: true },
    });
    const coinsByEpisode = new Map(unlocks.map((u) => [u.episodeId, u._sum.coinsSpent ?? 0]));
    return rows.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      coverUrl: s.coverUrl,
      genres: s.genres,
      sourceLang: s.sourceLang,
      viewCount: s.viewCount,
      episodes: s.episodes.map((e) => ({
        id: e.id,
        number: e.number,
        ready: e.hlsUrl !== '',
        subtitles: Object.keys((e.subtitles ?? {}) as object),
        dubs: Object.keys((e.dubs ?? {}) as object),
        coinsEarned: coinsByEpisode.get(e.id) ?? 0,
      })),
      totalEpisodes: s._count.episodes,
    }));
  }

  /** New series start as DRAFT; the admin reviews and publishes. */
  @Post('series')
  createSeries(@CurrentStudio() studio: Studio, @Body() dto: StudioSeriesDto) {
    return this.prisma.series.create({
      data: { ...dto, description: dto.description ?? '', studioId: studio.id, sourceLang: dto.sourceLang ?? 'en' },
    });
  }

  private async ownSeries(studio: Studio, seriesId: string) {
    const s = await this.prisma.series.findFirst({ where: { id: seriesId, studioId: studio.id } });
    if (!s) throw new NotFoundException('Series not found');
    return s;
  }

  /** multipart/form-data: file=<video>, number=<n>, title=<optional> */
  @Post('series/:id/episodes/upload')
  @UseInterceptors(FileInterceptor('file', videoUpload()))
  async upload(
    @CurrentStudio() studio: Studio,
    @Param('id', ParseUUIDPipe) seriesId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('number', ParseIntPipe) number: number,
    @Body('title') title?: string,
  ) {
    if (!file) throw new BadRequestException('Missing video file');
    await this.ownSeries(studio, seriesId);
    return this.media.createEpisodeFromUpload(seriesId, file, { number, title });
  }

  @Get('jobs')
  async jobs(@CurrentStudio() studio: Studio) {
    const eps = await this.prisma.episode.findMany({ where: { series: { studioId: studio.id } }, select: { id: true } });
    return this.jobsService.list({ episodeId: { in: eps.map((e) => e.id) } });
  }

  /** Coins spent on this studio's episodes in a month, and the estimated payout. */
  @Get('earnings')
  async earnings(@CurrentStudio() studio: Studio, @Query('month') month?: string) {
    const range = monthRange(month);
    const rows = await this.prisma.unlock.findMany({
      where: { method: 'COINS', createdAt: { gte: range.from, lt: range.to }, episode: { series: { studioId: studio.id } } },
      select: { coinsSpent: true, episode: { select: { seriesId: true, series: { select: { title: true } } } } },
    });
    const bySeries = new Map<string, { title: string; unlocks: number; coins: number }>();
    for (const r of rows) {
      const e = bySeries.get(r.episode.seriesId) ?? { title: r.episode.series.title, unlocks: 0, coins: 0 };
      e.unlocks++;
      e.coins += r.coinsSpent;
      bySeries.set(r.episode.seriesId, e);
    }
    const coins = rows.reduce((s, r) => s + r.coinsSpent, 0);
    const gross = coins * config.coinUsdValue;
    return {
      month: range.label,
      coinUsdValue: config.coinUsdValue,
      revenueSharePct: studio.revenueSharePct,
      unlocks: rows.length,
      coins,
      grossUsd: Number(gross.toFixed(2)),
      payoutUsd: Number(((gross * studio.revenueSharePct) / 100).toFixed(2)),
      series: [...bySeries.entries()].map(([seriesId, v]) => ({ seriesId, ...v })),
    };
  }
}

@Module({ controllers: [StudioController], providers: [StudioKeyGuard] })
export class StudioModule {}
