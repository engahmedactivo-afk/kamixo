import { Body, Controller, HttpCode, Injectable, Module, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsISO8601, IsObject, IsOptional, Matches, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { PrismaService } from '../common/prisma.service';

/** Funnel events the app sends: feed_view, ep_start, ep_complete, paywall_view, purchase, unlock, ... */
export class EventDto {
  @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  name: string;

  @IsOptional()
  @IsObject()
  props?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  ts?: string;
}

export class EventBatchDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EventDto)
  events: EventDto[];
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(userId: string, events: EventDto[]) {
    if (events.length === 0) return { accepted: 0 };
    const { count } = await this.prisma.analyticsEvent.createMany({
      data: events.map((e) => ({
        userId,
        name: e.name,
        props: (e.props ?? {}) as Prisma.InputJsonValue,
        clientTs: e.ts ? new Date(e.ts) : null,
      })),
    });
    return { accepted: count };
  }
}

@Controller('events')
@UseGuards(UserAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post()
  @HttpCode(202)
  ingest(@CurrentUser() user: AuthUser, @Body() dto: EventBatchDto) {
    return this.analytics.ingest(user.id, dto.events);
  }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
