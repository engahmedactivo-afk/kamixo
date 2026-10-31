import { Body, Controller, Get, Injectable, Module, NotFoundException, Put, UseGuards } from '@nestjs/common';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { PrismaService } from '../common/prisma.service';

export class ProgressDto {
  @IsUUID()
  seriesId: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  episodeNumber: number;

  @IsInt()
  @Min(0)
  @Max(86400)
  positionSec: number;
}

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: string, dto: ProgressDto) {
    const exists = await this.prisma.series.count({ where: { id: dto.seriesId, status: 'PUBLISHED' } });
    if (!exists) throw new NotFoundException('Series not found');
    await this.prisma.watchProgress.upsert({
      where: { userId_seriesId: { userId, seriesId: dto.seriesId } },
      create: { userId, ...dto },
      update: { episodeNumber: dto.episodeNumber, positionSec: dto.positionSec },
    });
    return { ok: true };
  }

  async continueWatching(userId: string) {
    const rows = await this.prisma.watchProgress.findMany({
      where: { userId, series: { status: 'PUBLISHED' } },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      include: { series: { include: { _count: { select: { episodes: true } } } } },
    });
    return rows.map((r) => ({
      seriesId: r.seriesId,
      title: r.series.title,
      coverUrl: r.series.coverUrl,
      totalEpisodes: r.series._count.episodes,
      episodeNumber: r.episodeNumber,
      positionSec: r.positionSec,
      updatedAt: r.updatedAt,
    }));
  }
}

@Controller()
@UseGuards(UserAuthGuard)
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Put('progress')
  save(@CurrentUser() user: AuthUser, @Body() dto: ProgressDto) {
    return this.progress.save(user.id, dto);
  }

  @Get('me/continue-watching')
  list(@CurrentUser() user: AuthUser) {
    return this.progress.continueWatching(user.id);
  }
}

@Module({ controllers: [ProgressController], providers: [ProgressService] })
export class ProgressModule {}
