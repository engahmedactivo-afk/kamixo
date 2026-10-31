/** Phase 2 e2e: VIP, rewarded ads, rewards, RevenueCat webhook, /me, /config, share page. */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { PushService } from '../src/push/push.service';

process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.REVENUECAT_WEBHOOK_SECRET = 'rc-hook-secret';
process.env.AD_UNLOCK_DAILY_CAP = '2';
const ADMIN = { 'x-admin-key': 'test-admin-key' };

describe('Kamixo API phase 2 (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let seriesId: string;
  const episodeIds: string[] = [];
  const pushSent: { userIds: string[]; title: string }[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login() {
    const res = await http().post('/auth/guest').send({ deviceId: randomUUID() }).expect(201);
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PushService)
      .useValue({
        enabled: true,
        register: async (userId: string, token: string, platform: string) => {
          await prisma.pushToken.upsert({ where: { token }, create: { token, userId, platform }, update: { userId } });
        },
        sendToUsers: async (userIds: string[], msg: { title: string }) => {
          pushSent.push({ userIds, title: msg.title });
          return { sent: userIds.length, failed: 0 };
        },
        sendToAll: async (msg: { title: string }) => {
          pushSent.push({ userIds: ['*'], title: msg.title });
          return { sent: 1, failed: 0 };
        },
      })
      .compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsEvent","WatchProgress","Unlock","Purchase","WalletEntry","CoinPack","Episode","Series","User","VipPlan","Subscription","AdReward","DailyCheckIn","TaskCompletion","PushToken","AppSetting" CASCADE',
    );
    await prisma.coinPack.create({ data: { productId: 'coins_100', coins: 100, priceLabel: '$0.99' } });
    await http().post('/admin/vip-plans').set(ADMIN).send({ productId: 'vip_weekly', name: 'VIP Weekly', days: 7, priceLabel: '$4.99' }).expect(201);
    const s = await http()
      .post('/admin/series')
      .set(ADMIN)
      .send({ title: 'Drama', description: 'Desc', coverUrl: 'https://example.com/c.jpg', genres: ['Romance'], freeEpisodes: 1, coinsPerEpisode: 50 })
      .expect(201);
    seriesId = s.body.id;
    await http().patch(`/admin/series/${seriesId}`).set(ADMIN).send({ status: 'PUBLISHED' }).expect(200);
    for (let n = 1; n <= 4; n++) {
      const e = await http()
        .post(`/admin/series/${seriesId}/episodes`)
        .set(ADMIN)
        .send({ number: n, durationSec: 60, hlsUrl: `https://cdn.example.com/s/e${n}.m3u8` })
        .expect(201);
      episodeIds.push(e.body.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('/me reports balance, vip, ad usage and config', async () => {
    const { token, userId } = await login();
    const me = (await http().get('/me').set(auth(token)).expect(200)).body;
    expect(me).toMatchObject({ id: userId, balance: 0, hasPurchased: false, vip: { active: false }, ads: { cap: 2, remainingToday: 2 } });
    const cfg = (await http().get('/config').set(auth(token)).expect(200)).body;
    expect(cfg.variants.paywall_copy).toMatch(/^(control|urgency)$/);
    expect(cfg.adUnlockDailyCap).toBe(2);
  });

  it('VIP (sandbox sync) unlocks every episode without coins', async () => {
    const { token } = await login();
    await http().get(`/episodes/${episodeIds[3]}/playback`).set(auth(token)).expect(402);
    const plans = (await http().get('/subscriptions/plans').set(auth(token)).expect(200)).body;
    expect(plans[0].productId).toBe('vip_weekly');
    const vip = (await http().post('/subscriptions/sync').set(auth(token)).send({ productId: 'vip_weekly' }).expect(201)).body;
    expect(vip.active).toBe(true);
    await http().get(`/episodes/${episodeIds[3]}/playback`).set(auth(token)).expect(200);
    const detail = (await http().get(`/series/${seriesId}`).set(auth(token)).expect(200)).body;
    expect(detail.episodes.every((e: { locked: boolean }) => !e.locked)).toBe(true);
    expect((await http().post(`/episodes/${episodeIds[3]}/unlock`).set(auth(token)).expect(201)).body.charged).toBe(0);
    await http().post('/subscriptions/sync').set(auth(token)).send({ productId: 'nope' }).expect(400);
  });

  it('rewarded ads unlock episodes up to the daily cap, once per transaction', async () => {
    const { token } = await login();
    const unlock = (id: string, transactionId?: string) =>
      http().post(`/episodes/${id}/unlock-with-ad`).set(auth(token)).send(transactionId ? { transactionId } : {});
    expect((await unlock(episodeIds[1], 'ad-1').expect(201)).body).toEqual({ unlocked: true, duplicate: false });
    expect((await unlock(episodeIds[1], 'ad-1').expect(201)).body.duplicate).toBe(true);
    await http().get(`/episodes/${episodeIds[1]}/playback`).set(auth(token)).expect(200);
    await unlock(episodeIds[2]).expect(201);
    const over = await unlock(episodeIds[3]).expect(429);
    expect(over.body.code).toBe('AD_LIMIT_REACHED');
    expect((await http().get('/ads/usage').set(auth(token)).expect(200)).body).toEqual({ cap: 2, usedToday: 2, remainingToday: 0 });
    await http().get('/webhooks/admob/ssv?ad_unit=1&transaction_id=x&signature=bad&key_id=1').expect(200).expect({ ok: false });
  });

  it('daily check-in pays once per day with a streak, tasks pay once', async () => {
    const { token, userId } = await login();
    let r = (await http().get('/rewards').set(auth(token)).expect(200)).body;
    expect(r.checkIn).toMatchObject({ checkedInToday: false, streak: 0, nextReward: 10 });
    expect((await http().post('/rewards/check-in').set(auth(token)).expect(201)).body).toEqual({ coins: 10, streak: 1, balance: 10 });
    expect((await http().post('/rewards/check-in').set(auth(token)).expect(409)).body.code).toBe('ALREADY_CHECKED_IN');

    // Simulate a 3-day streak ending yesterday, then check in today.
    await prisma.dailyCheckIn.deleteMany({ where: { userId } });
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await prisma.dailyCheckIn.create({ data: { userId, day: y, streak: 3, coins: 15 } });
    r = (await http().get('/rewards').set(auth(token)).expect(200)).body;
    expect(r.checkIn).toMatchObject({ checkedInToday: false, streak: 3, nextReward: 15 });
    expect((await http().post('/rewards/check-in').set(auth(token)).expect(201)).body).toMatchObject({ coins: 15, streak: 4 });

    expect((await http().post('/rewards/tasks').set(auth(token)).send({ taskKey: 'enable_push' }).expect(201)).body.coins).toBe(30);
    expect((await http().post('/rewards/tasks').set(auth(token)).send({ taskKey: 'enable_push' }).expect(201)).body.coins).toBe(0);
    await http().post('/rewards/tasks').set(auth(token)).send({ taskKey: 'hack' }).expect(400);
    r = (await http().get('/rewards').set(auth(token)).expect(200)).body;
    expect(r.tasks.find((t: { key: string }) => t.key === 'enable_push').done).toBe(true);
    expect((await http().get('/wallet').set(auth(token)).expect(200)).body.balance).toBe(55);
  });

  it('RevenueCat webhook credits coins and applies subscriptions', async () => {
    const { token, userId } = await login();
    const hook = (event: object, authz = 'rc-hook-secret') =>
      http().post('/webhooks/revenuecat').set({ Authorization: authz }).send({ event });
    await hook({ type: 'NON_RENEWING_PURCHASE', app_user_id: userId, product_id: 'coins_100', transaction_id: 'rc-txn-1', store: 'APP_STORE' }, 'wrong').expect(401);
    await hook({ id: 'e1', type: 'NON_RENEWING_PURCHASE', app_user_id: userId, product_id: 'coins_100', transaction_id: 'rc-txn-1', store: 'APP_STORE' }).expect(200);
    await hook({ id: 'e1', type: 'NON_RENEWING_PURCHASE', app_user_id: userId, product_id: 'coins_100', transaction_id: 'rc-txn-1', store: 'APP_STORE' }).expect(200);
    expect((await http().get('/wallet').set(auth(token)).expect(200)).body.balance).toBe(100);

    const exp = Date.now() + 7 * 86400000;
    await hook({ id: 'e2', type: 'INITIAL_PURCHASE', app_user_id: userId, product_id: 'vip_weekly', store: 'PLAY_STORE', expiration_at_ms: exp }).expect(200);
    expect((await http().get('/subscriptions/me').set(auth(token)).expect(200)).body).toMatchObject({ active: true, willRenew: true, productId: 'vip_weekly' });
    await hook({ id: 'e3', type: 'CANCELLATION', app_user_id: userId, product_id: 'vip_weekly', store: 'PLAY_STORE', expiration_at_ms: exp }).expect(200);
    expect((await http().get('/subscriptions/me').set(auth(token)).expect(200)).body).toMatchObject({ active: true, willRenew: false });
    await hook({ id: 'e4', type: 'EXPIRATION', app_user_id: userId, product_id: 'vip_weekly', store: 'PLAY_STORE', expiration_at_ms: Date.now() - 1000 }).expect(200);
    expect((await http().get('/subscriptions/me').set(auth(token)).expect(200)).body.active).toBe(false);
    expect((await hook({ id: 'e5', type: 'TEST', app_user_id: 'nobody', product_id: 'x' }).expect(200)).body.ignored).toBe('unknown user');
  });

  it('registers push tokens and notifies series watchers on new episodes', async () => {
    const { token, userId } = await login();
    await http().post('/me/push-token').set(auth(token)).send({ token: 'fcm-token-1234567890', platform: 'android' }).expect(204);
    await http().put('/progress').set(auth(token)).send({ seriesId, episodeNumber: 2, positionSec: 10 }).expect(200);
    pushSent.length = 0;
    await http().post(`/admin/series/${seriesId}/episodes`).set(ADMIN).send({ number: 5, durationSec: 60, hlsUrl: 'https://cdn.example.com/s/e5.m3u8' }).expect(201);
    await new Promise((r) => setTimeout(r, 50));
    expect(pushSent).toEqual([{ userIds: expect.arrayContaining([userId]), title: 'Drama' }]);

    const res = await http().post('/admin/push').set(ADMIN).send({ title: 'Hi', body: 'There', audience: 'all' }).expect(201);
    expect(res.body.sent).toBe(1);
    await http().post('/admin/push').set(ADMIN).send({ title: 'Hi', body: 'There', audience: 'series' }).expect(400);
    const stats = (await http().get('/admin/stats').set(ADMIN).expect(200)).body;
    expect(stats).toMatchObject({ pushTokens: 1, pushEnabled: true });
  });

  it('admin can edit remote config and users see it', async () => {
    await http().patch('/admin/settings/config').set(ADMIN).send({ firstPurchaseBonusPct: 50, experiments: { paywall_copy: ['only'] } }).expect(200);
    await http().patch('/admin/settings/config').set(ADMIN).send({ paywallPrimary: 'nope' }).expect(400);
    const { token } = await login();
    const cfg = (await http().get('/config').set(auth(token)).expect(200)).body;
    expect(cfg).toMatchObject({ firstPurchaseBonusPct: 50, variants: { paywall_copy: 'only' } });
  });

  it('serves a share landing page that deep-links into the app', async () => {
    const res = await http().get(`/s/${seriesId}?ep=3`).expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain(`kamixo://series/${seriesId}?ep=3`);
    expect(res.text).toContain('<title>Drama – Kamixo</title>');
    await http().get(`/s/${randomUUID()}`).expect(404);
  });
});
