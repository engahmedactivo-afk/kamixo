import {
  Controller,
  DefaultValuePipe,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma, Series } from '@prisma/client';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { PrismaService } from '../common/prisma.service';
import { PlaybackModule } from '../playback/playback.module';
import { isFreeEpisode, PlaybackService } from '../playback/playback.service';

const MAX_PAGE = 50;

function summary(s: Series & { _count?: { episodes: number } }) {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    coverUrl: s.coverUrl,
    genres: s.genres,
    freeEpisodes: s.freeEpisodes,
    coinsPerEpisode: s.coinsPerEpisode,
    totalEpisodes: s._count?.episodes ?? 0,
    viewCount: s.viewCount,
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: PlaybackService,
  ) {}

  async genres(): Promise<{ genre: string; count: number }[]> {
    const rows = await this.prisma.$queryRaw<{ genre: string; count: bigint }[]>`
      SELECT g AS genre, COUNT(*) AS count
      FROM "Series", unnest("genres") AS g
      WHERE "status" = 'PUBLISHED'
      GROUP BY g ORDER BY count DESC, g ASC`;
    return rows.map((r) => ({ genre: r.genre, count: Number(r.count) }));
  }

  /** Full-screen swipe feed: popular series with episode 1 ready to autoplay. */
  async feed(offset: number, limit: number) {
    limit = Math.min(Math.max(limit, 1), MAX_PAGE);
    const series = await this.prisma.series.findMany({
      where: { status: 'PUBLISHED', episodes: { some: { number: 1 } } },
      orderBy: [{ viewCount: 'desc' }, { publishedAt: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit,
      include: { _count: { select: { episodes: true } }, episodes: { where: { number: 1 } } },
    });
    return {
      items: series.map((s) => {
        const ep1 = s.episodes[0];
        return {
          series: summary(s),
          episode: { id: ep1.id, number: 1, durationSec: ep1.durationSec, playback: this.playback.buildPlayback(ep1) },
        };
      }),
      nextOffset: series.length === limit ? offset + limit : null,
    };
  }

  async list(opts: { genre?: string; sort: 'popular' | 'new'; q?: string; offset: number; limit: number }) {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE);
    const where: Prisma.SeriesWhereInput = {
      status: 'PUBLISHED',
      ...(opts.genre && { genres: { has: opts.genre } }),
      ...(opts.q && { title: { contains: opts.q, mode: 'insensitive' } }),
    };
    const orderBy: Prisma.SeriesOrderByWithRelationInput[] =
      opts.sort === 'new'
        ? [{ publishedAt: 'desc' }, { id: 'asc' }]
        : [{ viewCount: 'desc' }, { publishedAt: 'desc' }, { id: 'asc' }];
    const rows = await this.prisma.series.findMany({
      where,
      orderBy,
      skip: opts.offset,
      take: limit,
      include: { _count: { select: { episodes: true } } },
    });
    return { items: rows.map(summary), nextOffset: rows.length === limit ? opts.offset + limit : null };
  }

  async detail(userId: string, seriesId: string) {
    const s = await this.prisma.series.findFirst({
      where: { id: seriesId, status: 'PUBLISHED' },
      include: {
        _count: { select: { episodes: true } },
        episodes: { orderBy: { number: 'asc' }, select: { id: true, number: true, title: true, durationSec: true } },
      },
    });
    if (!s) throw new NotFoundException('Series not found');
    const [unlocks, progress] = await Promise.all([
      this.prisma.unlock.findMany({
        where: { userId, episode: { seriesId } },
        select: { episodeId: true },
      }),
      this.prisma.watchProgress.findUnique({ where: { userId_seriesId: { userId, seriesId } } }),
    ]);
    const unlocked = new Set(unlocks.map((u) => u.episodeId));
    return {
      series: summary(s),
      episodes: s.episodes.map((e) => {
        const free = isFreeEpisode(e, s);
        return { ...e, free, locked: !free && !unlocked.has(e.id) };
      }),
      progress: progress ? { episodeNumber: progress.episodeNumber, positionSec: progress.positionSec } : null,
    };
  }
}

@Controller()
@UseGuards(UserAuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('genres')
  genres() {
    return this.catalog.genres();
  }

  @Get('feed')
  feed(
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.catalog.feed(Math.max(offset, 0), limit);
  }

  @Get('series')
  list(
    @Query('genre') genre: string | undefined,
    @Query('q') q: string | undefined,
    @Query('sort', new DefaultValuePipe('popular')) sort: string,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.catalog.list({
      genre,
      q: q?.trim() || undefined,
      sort: sort === 'new' ? 'new' : 'popular',
      offset: Math.max(offset, 0),
      limit,
    });
  }

  @Get('series/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.detail(user.id, id);
  }
}

@Module({
  imports: [PlaybackModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
