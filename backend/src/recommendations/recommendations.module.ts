import { Controller, Get, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { PrismaService } from '../common/prisma.service';

/**
 * Item-based collaborative filtering on watch history:
 * score(A,B) = users who watched both / sqrt(users(A) * users(B))  (cosine on binary vectors).
 * Recomputed hourly in SQL; small catalogs (thousands of series) finish in well under a second.
 */
@Injectable()
export class RecommendationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RecommendationsService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.JOB_RUNNER !== 'off') {
      this.timer = setInterval(() => void this.recompute().catch((e) => this.log.error(e)), 3600_000);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async recompute(): Promise<{ pairs: number }> {
    const pairs = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "SeriesSimilarity"`;
      return tx.$executeRaw`
        INSERT INTO "SeriesSimilarity" ("seriesId", "relatedId", "score")
        SELECT a."seriesId", b."seriesId",
               COUNT(*)::float / SQRT(MAX(ca.n) * MAX(cb.n))
        FROM "WatchProgress" a
        JOIN "WatchProgress" b ON a."userId" = b."userId" AND a."seriesId" <> b."seriesId"
        JOIN (SELECT "seriesId", COUNT(*) AS n FROM "WatchProgress" GROUP BY "seriesId") ca ON ca."seriesId" = a."seriesId"
        JOIN (SELECT "seriesId", COUNT(*) AS n FROM "WatchProgress" GROUP BY "seriesId") cb ON cb."seriesId" = b."seriesId"
        GROUP BY a."seriesId", b."seriesId"
        HAVING COUNT(*) >= 2`;
    });
    return { pairs };
  }

  /** Series similar to [seriesId], published, best first. */
  async related(seriesId: string, limit = 10): Promise<string[]> {
    const rows = await this.prisma.seriesSimilarity.findMany({
      where: { seriesId },
      orderBy: { score: 'desc' },
      take: limit * 2,
    });
    if (rows.length === 0) return [];
    const published = await this.prisma.series.findMany({
      where: { id: { in: rows.map((r) => r.relatedId) }, status: 'PUBLISHED' },
      select: { id: true },
    });
    const ok = new Set(published.map((p) => p.id));
    return rows.map((r) => r.relatedId).filter((id) => ok.has(id)).slice(0, limit);
  }

  /**
   * Personalized ordering for the feed: series the user hasn't started, scored by similarity to what they
   * watched (recent history weighs more), falling back to popularity. Returns null for users with no history.
   */
  async rankForUser(userId: string): Promise<string[] | null> {
    const history = await this.prisma.watchProgress.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { seriesId: true },
    });
    if (history.length === 0) return null;
    const seen = new Set(history.map((h) => h.seriesId));
    const sims = await this.prisma.seriesSimilarity.findMany({ where: { seriesId: { in: [...seen] } } });
    const weight = new Map(history.map((h, i) => [h.seriesId, 1 / (1 + i * 0.25)]));
    const score = new Map<string, number>();
    for (const s of sims) {
      if (seen.has(s.relatedId)) continue;
      score.set(s.relatedId, (score.get(s.relatedId) ?? 0) + s.score * (weight.get(s.seriesId) ?? 1));
    }
    const candidates = await this.prisma.series.findMany({
      where: { status: 'PUBLISHED', id: { notIn: [...seen] }, episodes: { some: { number: 1, hlsUrl: { not: '' } } } },
      select: { id: true, viewCount: true },
    });
    const maxViews = Math.max(1, ...candidates.map((c) => c.viewCount));
    return candidates
      .map((c) => ({ id: c.id, s: (score.get(c.id) ?? 0) * 10 + c.viewCount / maxViews }))
      .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
      .map((c) => c.id);
  }
}

@Controller('series')
@UseGuards(UserAuthGuard)
export class RelatedController {
  constructor(
    private readonly recs: RecommendationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':id/related')
  async related(@CurrentUser() _user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    let ids = await this.recs.related(id);
    if (ids.length < 4) {
      // Cold start: same genre, most popular.
      const s = await this.prisma.series.findUnique({ where: { id }, select: { genres: true } });
      const more = await this.prisma.series.findMany({
        where: { status: 'PUBLISHED', id: { notIn: [id, ...ids] }, ...(s?.genres.length && { genres: { hasSome: s.genres } }) },
        orderBy: { viewCount: 'desc' },
        take: 8 - ids.length,
        select: { id: true },
      });
      ids = [...ids, ...more.map((m) => m.id)];
    }
    const rows = await this.prisma.series.findMany({
      where: { id: { in: ids } },
      include: { _count: { select: { episodes: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.filter((i) => byId.has(i)).map((i) => {
      const r = byId.get(i)!;
      return { id: r.id, title: r.title, coverUrl: r.coverUrl, genres: r.genres, totalEpisodes: r._count.episodes };
    });
  }
}

@Module({ controllers: [RelatedController], providers: [RecommendationsService], exports: [RecommendationsService] })
export class RecommendationsModule {}
