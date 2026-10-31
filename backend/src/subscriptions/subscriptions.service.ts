import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RevenueCatClient } from '../common/revenuecat.client';
import { config } from '../config';

export interface VipStatus {
  active: boolean;
  productId: string | null;
  expiresAt: string | null;
  willRenew: boolean;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rc: RevenueCatClient,
  ) {}

  async isVip(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const sub = await tx.subscription.findUnique({ where: { userId }, select: { expiresAt: true } });
    return sub !== null && sub.expiresAt > new Date();
  }

  async status(userId: string): Promise<VipStatus> {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    const active = sub !== null && sub.expiresAt > new Date();
    return {
      active,
      productId: active ? sub.productId : null,
      expiresAt: sub?.expiresAt.toISOString() ?? null,
      willRenew: active && sub.willRenew,
    };
  }

  plans() {
    return this.prisma.vipPlan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { days: 'asc' }],
      select: { productId: true, name: true, days: true, priceLabel: true },
    });
  }

  /** Writes the VIP state. Used by the webhook and by sync(). */
  async apply(userId: string, data: { productId: string; store?: string; expiresAt: Date; willRenew: boolean; eventId?: string }) {
    const payload = {
      productId: data.productId,
      store: data.store ?? '',
      expiresAt: data.expiresAt,
      willRenew: data.willRenew,
      lastEventId: data.eventId,
    };
    await this.prisma.subscription.upsert({ where: { userId }, create: { userId, ...payload }, update: payload });
  }

  /**
   * Called by the app right after a store purchase (or on "restore purchases").
   * Verifies with RevenueCat and stores the real expiry, or grants a trial period in sandbox mode.
   */
  async sync(userId: string, productId: string): Promise<VipStatus> {
    const plan = await this.prisma.vipPlan.findUnique({ where: { productId } });
    if (!plan) throw new AppError(HttpStatus.BAD_REQUEST, 'UNKNOWN_PRODUCT', 'Unknown VIP plan');

    if (config.purchaseVerifier === 'sandbox') {
      await this.apply(userId, { productId, store: 'sandbox', expiresAt: new Date(Date.now() + plan.days * 86400000), willRenew: true });
      return this.status(userId);
    }
    const sub = await this.rc.subscriber(userId);
    const entry = sub?.subscriptions?.[productId];
    const expires = entry?.expires_date ? new Date(entry.expires_date) : null;
    if (!expires || expires <= new Date()) {
      throw new AppError(HttpStatus.PAYMENT_REQUIRED, 'PURCHASE_NOT_VERIFIED', 'No active subscription found');
    }
    await this.apply(userId, { productId, store: entry?.store, expiresAt: expires, willRenew: !entry?.unsubscribe_detected_at });
    return this.status(userId);
  }
}
