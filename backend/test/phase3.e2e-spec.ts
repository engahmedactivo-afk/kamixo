/** Phase 3 e2e: media pipeline (ffmpeg), AI subtitles/dubs (sandbox), studio portal, web payments, recommendations, SEO. */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { ffmpeg } from '../src/media/ffmpeg';
import { JobsService } from '../src/media/jobs.service';
import { PushService } from '../src/push/push.service';

const mediaDir = mkdtempSync(join(tmpdir(), 'kamixo-media-'));
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.MEDIA_DIR = mediaDir;
process.env.JOB_RUNNER = 'off';
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.PUBLIC_BASE_URL = 'http://api.test';
const ADMIN = { 'x-admin-key': 'test-admin-key' };

describe('Kamixo API phase 3 (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jobs: JobsService;
  let seriesId: string;
  let studioKey: string;
  let studioId: string;
  let sample: string;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login() {
    const res = await http().post('/auth/guest').send({ deviceId: randomUUID() }).expect(201);
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  beforeAll(async () => {
    sample = join(mediaDir, 'sample.mp4');
    await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=12:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sample]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PushService)
      .useValue({ enabled: false, register: async () => undefined, sendToUsers: async () => ({ sent: 0, failed: 0 }), sendToAll: async () => ({ sent: 0, failed: 0 }) })
      .compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
    await app.init();
    prisma = app.get(PrismaService);
    jobs = app.get(JobsService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsEvent","WatchProgress","Unlock","Purchase","WalletEntry","CoinPack","Episode","Series","User","VipPlan","Subscription","AdReward","DailyCheckIn","TaskCompletion","PushToken","AppSetting","Job","Studio","SeriesSimilarity" CASCADE',
    );
    await prisma.coinPack.create({ data: { productId: 'coins_100', coins: 100, priceLabel: '$0.99', priceCents: 99 } });
    await prisma.vipPlan.create({ data: { productId: 'vip_weekly', name: 'VIP Weekly', days: 7, priceLabel: '$4.99', priceCents: 499 } });

    const studio = await http().post('/admin/studios').set(ADMIN).send({ name: 'Moon Studio', email: 'hi@moon.example', revenueSharePct: 60 }).expect(201);
    studioKey = studio.body.apiKey;
    studioId = studio.body.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('studio creates a series and uploads an episode that gets transcoded to HLS', async () => {
    await http().get('/studio/me').set({ 'x-studio-key': 'nope-nope-nope-nope' }).expect(401);
    const me = (await http().get('/studio/me').set({ 'x-studio-key': studioKey }).expect(200)).body;
    expect(me).toMatchObject({ name: 'Moon Studio', revenueSharePct: 60 });

    const s = await http().post('/studio/series').set({ 'x-studio-key': studioKey })
      .send({ title: 'Uploaded Drama', description: 'From a studio', coverUrl: 'https://example.com/c.jpg', genres: ['Romance'], sourceLang: 'en' }).expect(201);
    seriesId = s.body.id;
    expect(s.body.status).toBe('DRAFT');

    await http().post(`/studio/series/${seriesId}/episodes/upload`).set({ 'x-studio-key': studioKey }).field('number', '1').attach('file', sample, 'bad.txt').expect(400);
    const up = await http().post(`/studio/series/${seriesId}/episodes/upload`).set({ 'x-studio-key': studioKey }).field('number', '1').field('title', 'Pilot').attach('file', sample).expect(201);
    expect(up.body.job.type).toBe('TRANSCODE');
    expect(up.body.episode.hlsUrl).toBe('');

    // Someone else's series is not uploadable with this key.
    const other = await http().post('/admin/series').set(ADMIN).send({ title: 'Other', coverUrl: 'https://example.com/o.jpg', genres: [], freeEpisodes: 1, coinsPerEpisode: 10 }).expect(201);
    await http().post(`/studio/series/${other.body.id}/episodes/upload`).set({ 'x-studio-key': studioKey }).field('number', '1').attach('file', sample).expect(404);

    await jobs.tick();
    const job = (await http().get('/studio/jobs').set({ 'x-studio-key': studioKey }).expect(200)).body[0];
    expect(job.status).toBe('DONE');
    expect(job.result.hlsUrl).toMatch(/^http:\/\/api\.test\/media\/hls\/.+\/main\/master\.m3u8$/);
    expect(job.result.durationSec).toBe(5);
    const master = readFileSync(join(mediaDir, 'hls', up.body.episode.id, 'main', 'master.m3u8'), 'utf8');
    expect(master).toContain('720p/index.m3u8');
    expect(master).toContain('480p/index.m3u8');
    expect(existsSync(join(mediaDir, 'hls', up.body.episode.id, 'main', '480p', 'seg_0000.ts'))).toBe(true);
    const list = (await http().get('/studio/series').set({ 'x-studio-key': studioKey }).expect(200)).body;
    expect(list[0].episodes[0]).toMatchObject({ number: 1, ready: true });
  }, 120_000);

  it('serves processing episodes as not ready, then publishes', async () => {
    await http().post(`/admin/series/${seriesId}/episodes/upload`).set(ADMIN).field('number', '2').attach('file', sample).expect(201);
    await http().patch(`/admin/series/${seriesId}`).set(ADMIN).send({ status: 'PUBLISHED', freeEpisodes: 1, coinsPerEpisode: 50 }).expect(200);
    const { token } = await login();
    const detail = (await http().get(`/series/${seriesId}`).set(auth(token)).expect(200)).body;
    expect(detail.episodes.map((e: { ready: boolean }) => e.ready)).toEqual([true, false]);
    const res = await http().get(`/episodes/${detail.episodes[1].id}/playback`).set(auth(token)).expect(409);
    expect(res.body.code).toBe('EPISODE_PROCESSING');
    await jobs.tick();
    expect((await http().get(`/series/${seriesId}`).set(auth(token)).expect(200)).body.episodes[1].ready).toBe(true);
  }, 120_000);

  it('generates subtitles and an AI dub, and playback can pick the dub', async () => {
    const ep = await prisma.episode.findFirstOrThrow({ where: { seriesId, number: 1 } });
    await http().post(`/admin/episodes/${ep.id}/subtitles`).set(ADMIN).send({ languages: ['es', 'pt'] }).expect(201);
    await http().post(`/admin/episodes/${ep.id}/dub`).set(ADMIN).send({ language: 'es' }).expect(201);
    await http().post(`/admin/episodes/${ep.id}/subtitles`).set(ADMIN).send({ languages: ['EN'] }).expect(400);
    await jobs.tick();
    const done = (await http().get('/admin/jobs').set(ADMIN).expect(200)).body;
    expect(done.filter((j: { status: string }) => j.status === 'FAILED')).toEqual([]);

    const updated = await prisma.episode.findUniqueOrThrow({ where: { id: ep.id } });
    expect(Object.keys(updated.subtitles as object).sort()).toEqual(['en', 'es', 'pt']);
    const es = readFileSync(join(mediaDir, 'subs', ep.id, 'es.vtt'), 'utf8');
    expect(es).toContain('[es] Sandbox en line 1');
    expect((updated.dubs as Record<string, string>).es).toMatch(/\/media\/hls\/.+\/es\/master\.m3u8$/);
    expect(existsSync(join(mediaDir, 'hls', ep.id, 'es', '720p', 'seg_0000.ts'))).toBe(true);

    const { token } = await login();
    const plain = (await http().get(`/episodes/${ep.id}/playback`).set(auth(token)).expect(200)).body;
    expect(plain.url).toContain('/main/master.m3u8');
    expect(plain.dubs).toEqual(['es']);
    expect(Object.keys(plain.subtitles).sort()).toEqual(['en', 'es', 'pt']);
    const dubbed = (await http().get(`/episodes/${ep.id}/playback?lang=es`).set(auth(token)).expect(200)).body;
    expect(dubbed.url).toContain('/es/master.m3u8');
    expect((await http().get(`/episodes/${ep.id}/playback?lang=fr`).set(auth(token)).expect(200)).body.url).toContain('/main/');
    // The media files are actually served.
    await http().get(`/media/subs/${ep.id}/es.vtt`).expect(200).expect('Content-Type', /text\/vtt/);
  }, 180_000);

  it('dub job on an episode without a source file fails cleanly', async () => {
    const ext = await http().post(`/admin/series/${seriesId}/episodes`).set(ADMIN).send({ number: 9, durationSec: 60, hlsUrl: 'https://cdn.example.com/x.m3u8' }).expect(201);
    const job = (await http().post(`/admin/episodes/${ext.body.id}/dub`).set(ADMIN).send({ language: 'es' }).expect(201)).body;
    await jobs.tick();
    const j = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe('FAILED');
    expect(j.error).toContain('no uploaded source');
    await http().post(`/admin/jobs/${job.id}/retry`).set(ADMIN).expect(201);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('QUEUED');
    await prisma.job.delete({ where: { id: job.id } });
    await prisma.episode.delete({ where: { id: ext.body.id } });
  });

  it('web checkout (sandbox) credits coins and VIP; Stripe webhook needs a valid signature', async () => {
    const { token, userId } = await login();
    expect((await http().post('/web/checkout').set(auth(token)).send({ kind: 'coins', productId: 'coins_100' }).expect(201)).body).toEqual({ sandbox: true, url: null });
    expect((await http().get('/wallet').set(auth(token)).expect(200)).body.balance).toBe(100);
    await http().post('/web/checkout').set(auth(token)).send({ kind: 'vip', productId: 'vip_weekly' }).expect(201);
    await http().post('/web/checkout').set(auth(token)).send({ kind: 'vip', productId: 'vip_weekly' }).expect(201);
    const vip = (await http().get('/subscriptions/me').set(auth(token)).expect(200)).body;
    expect(vip.active).toBe(true);
    expect(new Date(vip.expiresAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86400000); // two passes stack
    await http().post('/web/checkout').set(auth(token)).send({ kind: 'coins', productId: 'nope' }).expect(400);

    const body = JSON.stringify({ id: 'cs_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { userId, kind: 'coins', productId: 'coins_100' } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex')}`;
    await http().post('/webhooks/stripe').set({ 'stripe-signature': 't=1,v1=bad', 'content-type': 'application/json' }).send(body).expect(401);
    await http().post('/webhooks/stripe').set({ 'stripe-signature': sig, 'content-type': 'application/json' }).send(body).expect(200);
    await http().post('/webhooks/stripe').set({ 'stripe-signature': sig, 'content-type': 'application/json' }).send(body).expect(200);
    expect((await http().get('/wallet').set(auth(token)).expect(200)).body.balance).toBe(200);
  });

  it('reports studio earnings from coin unlocks', async () => {
    const { token } = await login();
    await http().post('/web/checkout').set(auth(token)).send({ kind: 'coins', productId: 'coins_100' }).expect(201);
    const ep2 = await prisma.episode.findFirstOrThrow({ where: { seriesId, number: 2 } });
    await http().post(`/episodes/${ep2.id}/unlock`).set(auth(token)).expect(201);
    const month = new Date().toISOString().slice(0, 7);
    const e = (await http().get(`/studio/earnings?month=${month}`).set({ 'x-studio-key': studioKey }).expect(200)).body;
    expect(e).toMatchObject({ month, unlocks: 1, coins: 50, grossUsd: 0.5, payoutUsd: 0.3, revenueSharePct: 60 });
    expect(e.series[0]).toMatchObject({ seriesId, title: 'Uploaded Drama', coins: 50 });
    expect((await http().get('/studio/earnings?month=2000-01').set({ 'x-studio-key': studioKey }).expect(200)).body.coins).toBe(0);
    const list = (await http().get('/studio/series').set({ 'x-studio-key': studioKey }).expect(200)).body;
    expect(list[0].episodes.find((x: { number: number }) => x.number === 2).coinsEarned).toBe(50);
    const studios = (await http().get('/admin/studios').set(ADMIN).expect(200)).body;
    expect(studios.find((s: { id: string }) => s.id === studioId)._count.series).toBe(1);
  });

  it('personalizes the feed from co-watching and lists related series', async () => {
    // Build three more published series (A, B, C) with ready episode 1 from the uploaded one.
    const make = async (title: string, views: number) => {
      const s = await prisma.series.create({ data: { title, coverUrl: 'https://example.com/c.jpg', genres: ['Romance'], status: 'PUBLISHED', publishedAt: new Date(), viewCount: views, episodes: { create: { number: 1, hlsUrl: 'https://cdn.example.com/e1.m3u8' } } } });
      return s.id;
    };
    const [a, b, c] = [await make('A', 500), await make('B', 50), await make('C', 10)];
    // Users who watched A also watched C (3 users); B is popular but unrelated.
    for (let i = 0; i < 3; i++) {
      const u = await prisma.user.create({ data: { deviceId: randomUUID() } });
      await prisma.watchProgress.createMany({ data: [{ userId: u.id, seriesId: a, episodeNumber: 1 }, { userId: u.id, seriesId: c, episodeNumber: 1 }] });
    }
    expect((await http().post('/admin/recommendations/recompute').set(ADMIN).expect(201)).body.pairs).toBeGreaterThan(0);

    const fresh = await login();
    const popular = (await http().get('/feed').set(auth(fresh.token)).expect(200)).body.items.map((i: { series: { title: string } }) => i.series.title);
    expect(popular.slice(0, 2)).toEqual(['A', 'B']);

    const fan = await login();
    await http().put('/progress').set(auth(fan.token)).send({ seriesId: a, episodeNumber: 1, positionSec: 5 }).expect(200);
    const personal = (await http().get('/feed').set(auth(fan.token)).expect(200)).body.items.map((i: { series: { title: string } }) => i.series.title);
    expect(personal[0]).toBe('C'); // similar to A beats popular B
    expect(personal).not.toContain('A'); // already started

    const related = (await http().get(`/series/${a}/related`).set(auth(fan.token)).expect(200)).body;
    expect(related[0].title).toBe('C');
    expect(related.length).toBeGreaterThanOrEqual(2); // padded with same-genre popular series
  });

  it('serves SEO pages, sitemap and robots', async () => {
    const page = await http().get(`/watch/${seriesId}`).set('User-Agent', 'Googlebot').expect(200);
    expect(page.text).toContain('<title>Uploaded Drama – watch all');
    expect(page.text).toContain('"@type":"TVSeries"');
    expect(page.text).toContain(`/web/#/series/${seriesId}`);
    await http().get(`/watch/${randomUUID()}`).expect(404);
    const sitemap = await http().get('/sitemap.xml').expect(200).expect('Content-Type', /xml/);
    expect(sitemap.text).toContain(`/watch/${seriesId}`);
    expect((await http().get('/robots.txt').expect(200)).text).toContain('Sitemap:');
  });
});
