/**
 * End-to-end tests against a real Postgres database.
 * Uses DATABASE_URL (point it at a disposable test database: tables are truncated).
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { PURCHASE_VERIFIER, PurchaseVerifier } from '../src/wallet/purchase-verifier';

process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.JWT_SECRET = 'test-jwt-secret';
const ADMIN = { 'x-admin-key': 'test-admin-key' };

describe('Kamixo API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const verifier: PurchaseVerifier & { allow: boolean } = { allow: true, verify: async () => verifier.allow };
  let seriesId: string;
  const episodeIds: string[] = [];

  const http = () => request(app.getHttpServer());

  async function login(deviceId: string = randomUUID()) {
    const res = await http().post('/auth/guest').send({ deviceId, locale: 'en' }).expect(201);
    return { token: res.body.accessToken as string, userId: res.body.user.id as string, deviceId };
  }
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function buy(token: string, productId = 'coins_100', transactionId = randomUUID()) {
    return http().post('/wallet/purchases').set(auth(token)).send({ platform: 'ios', productId, transactionId });
  }

  beforeAll(async () => {
    delete process.env.PLAYBACK_SIGNING_SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PURCHASE_VERIFIER)
      .useValue(verifier)
      .compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsEvent","WatchProgress","Unlock","Purchase","WalletEntry","CoinPack","Episode","Series","User" CASCADE',
    );
    await prisma.coinPack.create({ data: { productId: 'coins_100', coins: 100, bonusCoins: 20, priceLabel: '$0.99' } });

    // Create content through the admin API.
    const s = await http()
      .post('/admin/series')
      .set(ADMIN)
      .send({ title: 'Test Drama', coverUrl: 'https://example.com/c.jpg', genres: ['Romance'], freeEpisodes: 2, coinsPerEpisode: 50 })
      .expect(201);
    seriesId = s.body.id;
    for (let n = 1; n <= 4; n++) {
      const e = await http()
        .post(`/admin/series/${seriesId}/episodes`)
        .set(ADMIN)
        .send({ number: n, durationSec: 60, hlsUrl: `https://cdn.example.com/s1/e${n}/index.m3u8`, subtitles: { en: `https://cdn.example.com/s1/e${n}/en.vtt` } })
        .expect(201);
      episodeIds.push(e.body.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects admin calls without the admin key', async () => {
    await http().get('/admin/series').expect(401);
    await http().get('/admin/series').set({ 'x-admin-key': 'wrong' }).expect(401);
  });

  it('requires a token for user endpoints', async () => {
    await http().get('/feed').expect(401);
    await http().get('/feed').set({ Authorization: 'Bearer nope' }).expect(401);
  });

  it('guest login is stable per device', async () => {
    const a = await login('device-aaaaaaaaaaaaaaaa');
    const b = await login('device-aaaaaaaaaaaaaaaa');
    expect(a.userId).toBe(b.userId);
    await http().post('/auth/guest').send({ deviceId: 'short' }).expect(400);
  });

  it('hides draft series, shows them once published', async () => {
    const { token } = await login();
    expect((await http().get('/feed').set(auth(token)).expect(200)).body.items).toHaveLength(0);
    await http().get(`/series/${seriesId}`).set(auth(token)).expect(404);
    await http().get(`/episodes/${episodeIds[0]}/playback`).set(auth(token)).expect(404);

    await http().patch(`/admin/series/${seriesId}`).set(ADMIN).send({ status: 'PUBLISHED' }).expect(200);
    const feed = (await http().get('/feed').set(auth(token)).expect(200)).body;
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].series.totalEpisodes).toBe(4);
    expect(feed.items[0].episode.playback.url).toContain('/e1/index.m3u8');
    const genres = (await http().get('/genres').set(auth(token)).expect(200)).body;
    expect(genres).toEqual([{ genre: 'Romance', count: 1 }]);
  });

  it('marks free and locked episodes and gates playback', async () => {
    const { token } = await login();
    const detail = (await http().get(`/series/${seriesId}`).set(auth(token)).expect(200)).body;
    expect(detail.episodes.map((e: { locked: boolean }) => e.locked)).toEqual([false, false, true, true]);

    await http().get(`/episodes/${episodeIds[1]}/playback`).set(auth(token)).expect(200);
    const locked = await http().get(`/episodes/${episodeIds[2]}/playback`).set(auth(token)).expect(402);
    expect(locked.body).toMatchObject({ code: 'EPISODE_LOCKED', price: 50 });
  });

  it('credits purchases once per transaction and rejects unverified ones', async () => {
    const { token } = await login();
    const txn = randomUUID();
    expect((await buy(token, 'coins_100', txn).expect(201)).body).toEqual({ credited: 120, balance: 120 });
    expect((await buy(token, 'coins_100', txn).expect(201)).body).toEqual({ credited: 0, balance: 120 });

    const other = await login();
    await buy(other.token, 'coins_100', txn).expect(409);
    await buy(token, 'does_not_exist').expect(400);

    verifier.allow = false;
    const res = await buy(token).expect(402);
    expect(res.body.code).toBe('PURCHASE_NOT_VERIFIED');
    verifier.allow = true;

    const wallet = (await http().get('/wallet').set(auth(token)).expect(200)).body;
    expect(wallet.balance).toBe(120);
    expect(wallet.entries).toHaveLength(1);
  });

  it('unlocks with coins, never charges twice, and refuses when broke', async () => {
    const { token } = await login();
    const ep3 = episodeIds[2];
    const broke = await http().post(`/episodes/${ep3}/unlock`).set(auth(token)).expect(402);
    expect(broke.body).toMatchObject({ code: 'INSUFFICIENT_COINS', price: 50, balance: 0 });

    await buy(token).expect(201); // 120 coins
    expect((await http().post(`/episodes/${ep3}/unlock`).set(auth(token)).expect(201)).body).toEqual({ unlocked: true, charged: 50, balance: 70 });
    expect((await http().post(`/episodes/${ep3}/unlock`).set(auth(token)).expect(201)).body).toEqual({ unlocked: true, charged: 0, balance: 70 });
    await http().get(`/episodes/${ep3}/playback`).set(auth(token)).expect(200);

    // Free episodes cost nothing.
    expect((await http().post(`/episodes/${episodeIds[0]}/unlock`).set(auth(token)).expect(201)).body.charged).toBe(0);
  });

  it('cannot double-spend under concurrent unlock requests', async () => {
    const { token, userId } = await login();
    await prisma.walletEntry.create({ data: { userId, delta: 60, type: 'BONUS' } }); // enough for exactly one unlock
    const results = await Promise.all(
      [episodeIds[2], episodeIds[3], episodeIds[2], episodeIds[3]].map((id) =>
        http().post(`/episodes/${id}/unlock`).set(auth(token)),
      ),
    );
    const charged = results.filter((r) => r.status === 201).reduce((sum, r) => sum + r.body.charged, 0);
    expect(charged).toBe(50);
    const wallet = (await http().get('/wallet').set(auth(token)).expect(200)).body;
    expect(wallet.balance).toBe(10);
    expect(await prisma.unlock.count({ where: { userId } })).toBe(1);
  });

  it('saves progress for continue-watching', async () => {
    const { token } = await login();
    await http().put('/progress').set(auth(token)).send({ seriesId, episodeNumber: 2, positionSec: 31 }).expect(200);
    await http().put('/progress').set(auth(token)).send({ seriesId, episodeNumber: 3, positionSec: 5 }).expect(200);
    const list = (await http().get('/me/continue-watching').set(auth(token)).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ seriesId, episodeNumber: 3, positionSec: 5, totalEpisodes: 4 });
    const detail = (await http().get(`/series/${seriesId}`).set(auth(token)).expect(200)).body;
    expect(detail.progress).toEqual({ episodeNumber: 3, positionSec: 5 });
  });

  it('ingests analytics events', async () => {
    const { token } = await login();
    const res = await http()
      .post('/events')
      .set(auth(token))
      .send({ events: [{ name: 'ep_start', props: { seriesId, ep: 1 }, ts: new Date().toISOString() }, { name: 'paywall_view' }] })
      .expect(202);
    expect(res.body.accepted).toBe(2);
    await http().post('/events').set(auth(token)).send({ events: [{ name: 'Bad Name!' }] }).expect(400);
  });

  it('signs playback URLs when a signing secret is configured', async () => {
    process.env.PLAYBACK_SIGNING_SECRET = 'test-secret';
    try {
      const { token } = await login();
      const res = (await http().get(`/episodes/${episodeIds[0]}/playback`).set(auth(token)).expect(200)).body;
      const url = new URL(res.url);
      expect(url.searchParams.get('sig')).toMatch(/^[0-9a-f]{64}$/);
      expect(res.expiresAt).not.toBeNull();
      expect(new URL(res.subtitles.en).searchParams.get('sig')).toBe(url.searchParams.get('sig'));
    } finally {
      delete process.env.PLAYBACK_SIGNING_SECRET;
    }
  });
});
