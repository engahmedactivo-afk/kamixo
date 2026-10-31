import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Episode, Series } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { config } from '../config';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export type EpisodeWithSeries = Episode & { series: Pick<Series, 'id' | 'freeEpisodes' | 'coinsPerEpisode' | 'status'> };

export interface PlaybackInfo {
  url: string;
  subtitles: Record<string, string>;
  expiresAt: string | null;
  /** Languages that have an AI-dubbed audio version */
  dubs: string[];
}

/**
 * Signs a media URL so the CDN only serves it to entitled users for a limited time.
 *
 * The token covers the URL's *directory* so the HLS playlist and every segment next to it
 * share one token: `?exp=<unix>&sig=hex(HMAC_SHA256(secret, "<dir>/:<exp>"))`.
 * Validate it at the edge (Cloudflare Worker, Bunny/CloudFront token auth rule, ...).
 * With no PLAYBACK_SIGNING_SECRET set (local dev), the raw URL is returned.
 */
export function signMediaUrl(rawUrl: string, nowMs = Date.now()): { url: string; expiresAt: string | null } {
  const secret = config.playbackSigningSecret;
  if (!secret) return { url: rawUrl, expiresAt: null };
  const url = new URL(rawUrl);
  const exp = Math.floor(nowMs / 1000) + config.playbackUrlTtlSeconds;
  const dir = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
  const sig = createHmac('sha256', secret).update(`${dir}:${exp}`).digest('hex');
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);
  return { url: url.toString(), expiresAt: new Date(exp * 1000).toISOString() };
}

export function isFreeEpisode(ep: Pick<Episode, 'number'>, series: Pick<Series, 'freeEpisodes'>): boolean {
  return ep.number <= series.freeEpisodes;
}

@Injectable()
export class PlaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: SubscriptionsService,
  ) {}

  async findPublishedEpisode(episodeId: string): Promise<EpisodeWithSeries> {
    const ep = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: { series: { select: { id: true, freeEpisodes: true, coinsPerEpisode: true, status: true } } },
    });
    if (!ep || ep.series.status !== 'PUBLISHED') throw new NotFoundException('Episode not found');
    if (!ep.hlsUrl) throw new AppError(HttpStatus.CONFLICT, 'EPISODE_PROCESSING', 'This episode is still being processed');
    return ep;
  }

  async isEntitled(userId: string, ep: EpisodeWithSeries): Promise<boolean> {
    if (isFreeEpisode(ep, ep.series)) return true;
    if (await this.subs.isVip(userId)) return true;
    const unlock = await this.prisma.unlock.findUnique({
      where: { userId_episodeId: { userId, episodeId: ep.id } },
    });
    return unlock !== null;
  }

  /** [lang] picks an AI-dubbed version when one exists for that language. */
  buildPlayback(ep: Episode, lang?: string): PlaybackInfo {
    const dubs = (ep.dubs ?? {}) as Record<string, string>;
    const source = lang && dubs[lang] ? dubs[lang] : ep.hlsUrl;
    const { url, expiresAt } = signMediaUrl(source);
    const subtitles: Record<string, string> = {};
    for (const [lang, vtt] of Object.entries((ep.subtitles ?? {}) as Record<string, string>)) {
      subtitles[lang] = signMediaUrl(vtt).url;
    }
    return { url, subtitles, expiresAt, dubs: Object.keys(dubs) };
  }

  /** Returns a playable URL, or throws 402 EPISODE_LOCKED with the price so the app can show the paywall. */
  async getPlayback(userId: string, episodeId: string, lang?: string): Promise<PlaybackInfo> {
    const ep = await this.findPublishedEpisode(episodeId);
    if (!(await this.isEntitled(userId, ep))) {
      throw new AppError(HttpStatus.PAYMENT_REQUIRED, 'EPISODE_LOCKED', 'This episode is locked', {
        episodeId: ep.id,
        price: ep.series.coinsPerEpisode,
      });
    }
    if (ep.number === 1) {
      await this.prisma.series.update({ where: { id: ep.seriesId }, data: { viewCount: { increment: 1 } } });
    }
    return this.buildPlayback(ep, lang);
  }
}
