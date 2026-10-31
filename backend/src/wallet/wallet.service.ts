import { ConflictException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { PlaybackService } from '../playback/playback.service';
import { PURCHASE_VERIFIER, PurchaseClaim, PurchaseVerifier } from './purchase-verifier';

type Tx = Prisma.TransactionClient;

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: PlaybackService,
    @Inject(PURCHASE_VERIFIER) private readonly verifier: PurchaseVerifier,
  ) {}

  async balance(userId: string, tx: Tx = this.prisma): Promise<number> {
    const agg = await tx.walletEntry.aggregate({ where: { userId }, _sum: { delta: true } });
    return agg._sum.delta ?? 0;
  }

  /** Serializes all wallet writes for one user so concurrent requests cannot double-spend. */
  private async lockUser(tx: Tx, userId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  }

  async summary(userId: string) {
    const [balance, entries] = await Promise.all([
      this.balance(userId),
      this.prisma.walletEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, delta: true, type: true, note: true, createdAt: true },
      }),
    ]);
    return { balance, entries };
  }

  coinPacks() {
    return this.prisma.coinPack.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { coins: 'asc' }],
      select: { productId: true, coins: true, bonusCoins: true, priceLabel: true },
    });
  }

  /** Credits coins for a verified store purchase. Idempotent per transactionId. */
  async creditPurchase(claim: PurchaseClaim) {
    const pack = await this.prisma.coinPack.findUnique({ where: { productId: claim.productId } });
    if (!pack) throw new AppError(HttpStatus.BAD_REQUEST, 'UNKNOWN_PRODUCT', 'Unknown product');

    const existing = await this.prisma.purchase.findUnique({ where: { transactionId: claim.transactionId } });
    if (existing) return this.alreadyCredited(existing.userId, claim.userId);

    if (!(await this.verifier.verify(claim))) {
      throw new AppError(HttpStatus.PAYMENT_REQUIRED, 'PURCHASE_NOT_VERIFIED', 'Purchase could not be verified');
    }

    const coins = pack.coins + pack.bonusCoins;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, claim.userId);
        const purchase = await tx.purchase.create({
          data: {
            userId: claim.userId,
            platform: claim.platform,
            productId: pack.productId,
            transactionId: claim.transactionId,
            coins,
          },
        });
        await tx.walletEntry.create({
          data: { userId: claim.userId, delta: coins, type: 'PURCHASE', refId: purchase.id, note: pack.productId },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const p = await this.prisma.purchase.findUniqueOrThrow({ where: { transactionId: claim.transactionId } });
        return this.alreadyCredited(p.userId, claim.userId);
      }
      throw e;
    }
    return { credited: coins, balance: await this.balance(claim.userId) };
  }

  private async alreadyCredited(ownerId: string, userId: string) {
    if (ownerId !== userId) throw new ConflictException('Transaction already used by another account');
    return { credited: 0, balance: await this.balance(userId) };
  }

  /** Spends coins to unlock one episode. Idempotent: unlocking twice never charges twice. */
  async unlockWithCoins(userId: string, episodeId: string) {
    const ep = await this.playback.findPublishedEpisode(episodeId);
    if (await this.playback.isEntitled(userId, ep)) {
      return { unlocked: true, charged: 0, balance: await this.balance(userId) };
    }
    const price = ep.series.coinsPerEpisode;

    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const already = await tx.unlock.findUnique({ where: { userId_episodeId: { userId, episodeId } } });
      if (already) return { unlocked: true, charged: 0, balance: await this.balance(userId, tx) };

      const balance = await this.balance(userId, tx);
      if (balance < price) {
        throw new AppError(HttpStatus.PAYMENT_REQUIRED, 'INSUFFICIENT_COINS', 'Not enough coins', {
          price,
          balance,
        });
      }
      await tx.walletEntry.create({
        data: { userId, delta: -price, type: 'UNLOCK', refId: episodeId, note: `S:${ep.seriesId} E${ep.number}` },
      });
      await tx.unlock.create({ data: { userId, episodeId, method: 'COINS', coinsSpent: price } });
      return { unlocked: true, charged: price, balance: balance - price };
    });
  }
}
