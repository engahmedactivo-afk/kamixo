import { Controller, Get, Injectable, Module, UseGuards } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';

export const CONFIG_KEY = 'config';

/** Defaults; the admin can override any field through /admin/settings/config. */
export const DEFAULT_CONFIG = {
  /** Extra coins (%) on a user's first purchase. The app shows it on the paywall. */
  firstPurchaseBonusPct: 0,
  /** Which paywall layout to show first when a user has no coins: "coins" or "vip". */
  paywallPrimary: 'coins',
  /** A/B tests: name -> variants. A user always gets the same variant for a given test. */
  experiments: {
    paywall_copy: ['control', 'urgency'],
  } as Record<string, string[]>,
};

export type RemoteConfig = typeof DEFAULT_CONFIG;

/** Deterministic 0..99 bucket per user and experiment. */
export function bucket(userId: string, experiment: string): number {
  const h = createHash('sha1').update(`${experiment}:${userId}`).digest();
  return h.readUInt16BE(0) % 100;
}

@Injectable()
export class RemoteConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<RemoteConfig> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
    return { ...DEFAULT_CONFIG, ...((row?.value as Partial<RemoteConfig>) ?? {}) };
  }

  async set(patch: Partial<RemoteConfig>): Promise<RemoteConfig> {
    const next = { ...(await this.get()), ...patch };
    await this.prisma.appSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: next }, update: { value: next } });
    return next;
  }

  async forUser(userId: string) {
    const cfg = await this.get();
    const variants: Record<string, string> = {};
    for (const [name, options] of Object.entries(cfg.experiments)) {
      if (options.length > 0) variants[name] = options[Math.floor((bucket(userId, name) / 100) * options.length)];
    }
    return {
      firstPurchaseBonusPct: cfg.firstPurchaseBonusPct,
      paywallPrimary: cfg.paywallPrimary,
      variants,
      adUnlockDailyCap: config.adUnlockDailyCap,
      shareBaseUrl: `${config.publicBaseUrl}/s`,
    };
  }
}

@Controller('config')
@UseGuards(UserAuthGuard)
export class RemoteConfigController {
  constructor(private readonly rc: RemoteConfigService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.rc.forUser(user.id);
  }
}

@Module({ controllers: [RemoteConfigController], providers: [RemoteConfigService], exports: [RemoteConfigService] })
export class RemoteConfigModule {}
