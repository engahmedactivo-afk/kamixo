import { Body, Controller, Get, HttpStatus, Injectable, Module, Post, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { AuthUser, CurrentUser, UserAuthGuard } from '../auth/auth.guards';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { WalletModule } from '../wallet/wallet.module';
import { WalletService } from '../wallet/wallet.service';

/** Coins for day 1..7 of a streak; day 8+ repeats the last value. */
export const CHECK_IN_COINS = [10, 10, 15, 15, 20, 25, 40];

/** One-time tasks the app can complete. Keep keys stable: they are stored per user. */
export const TASKS: Record<string, { title: string; coins: number }> = {
  enable_push: { title: 'Turn on notifications', coins: 30 },
  share_app: { title: 'Share Kamixo with a friend', coins: 20 },
  finish_first_series: { title: 'Finish your first series', coins: 50 },
};

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export class CompleteTaskDto {
  @IsIn(Object.keys(TASKS))
  taskKey: string;
}

@Injectable()
export class RewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async summary(userId: string) {
    const today = utcDay();
    const yesterday = utcDay(new Date(Date.now() - 86400000));
    const [last, done] = await Promise.all([
      this.prisma.dailyCheckIn.findFirst({ where: { userId }, orderBy: { day: 'desc' } }),
      this.prisma.taskCompletion.findMany({ where: { userId }, select: { taskKey: true } }),
    ]);
    const checkedInToday = last?.day === today;
    const streak = checkedInToday ? last.streak : last?.day === yesterday ? last.streak : 0;
    const nextStreak = checkedInToday ? streak : streak + 1;
    const doneKeys = new Set(done.map((t) => t.taskKey));
    return {
      checkIn: {
        checkedInToday,
        streak,
        nextReward: CHECK_IN_COINS[Math.min(nextStreak, CHECK_IN_COINS.length) - 1],
        schedule: CHECK_IN_COINS,
      },
      tasks: Object.entries(TASKS).map(([key, t]) => ({ key, ...t, done: doneKeys.has(key) })),
    };
  }

  /** Grants today's check-in bonus once. Streak continues if the user checked in yesterday. */
  async checkIn(userId: string) {
    const today = utcDay();
    const yesterday = utcDay(new Date(Date.now() - 86400000));
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const last = await tx.dailyCheckIn.findFirst({ where: { userId }, orderBy: { day: 'desc' } });
      if (last?.day === today) {
        throw new AppError(HttpStatus.CONFLICT, 'ALREADY_CHECKED_IN', 'Already checked in today');
      }
      const streak = last?.day === yesterday ? last.streak + 1 : 1;
      const coins = CHECK_IN_COINS[Math.min(streak, CHECK_IN_COINS.length) - 1];
      await tx.dailyCheckIn.create({ data: { userId, day: today, streak, coins } });
      await this.wallet.grantBonus(tx, userId, coins, `checkin:${today}`);
      return { coins, streak, balance: await this.wallet.balance(userId, tx) };
    });
  }

  /** Grants a task reward once; a repeated call is a no-op with coins: 0. */
  async completeTask(userId: string, taskKey: string) {
    const task = TASKS[taskKey];
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const existing = await tx.taskCompletion.findUnique({ where: { userId_taskKey: { userId, taskKey } } });
      if (existing) return { coins: 0, balance: await this.wallet.balance(userId, tx) };
      await tx.taskCompletion.create({ data: { userId, taskKey, coins: task.coins } });
      await this.wallet.grantBonus(tx, userId, task.coins, `task:${taskKey}`);
      return { coins: task.coins, balance: await this.wallet.balance(userId, tx) };
    });
  }
}

@Controller('rewards')
@UseGuards(UserAuthGuard)
export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.rewards.summary(user.id);
  }

  @Post('check-in')
  checkIn(@CurrentUser() user: AuthUser) {
    return this.rewards.checkIn(user.id);
  }

  @Post('tasks')
  task(@CurrentUser() user: AuthUser, @Body() dto: CompleteTaskDto) {
    return this.rewards.completeTask(user.id, dto.taskKey);
  }
}

@Module({ imports: [WalletModule], controllers: [RewardsController], providers: [RewardsService], exports: [RewardsService] })
export class RewardsModule {}
