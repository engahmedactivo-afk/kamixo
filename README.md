# Kamixo

A short-drama (micro-drama) streaming app: vertical episodes of 1–3 minutes, a few free episodes per series, and coins to unlock the rest. See [`docs/PLAN.md`](docs/PLAN.md) for the product analysis and roadmap.

**Status: Phase 1 (MVP) is implemented.**

| Folder | What it is |
|---|---|
| [`backend/`](backend) | NestJS + Prisma + PostgreSQL API, and the admin CMS at `/admin/` |
| [`mobile/`](mobile) | Flutter app for Android and iOS |

## Features in Phase 1

- **For You feed:** a full-screen vertical swipe feed. Episode 1 of each series autoplays, and the next video is preloaded.
- **Series player:** swipe up for the next episode, with auto-advance at the end and an episode grid that shows lock icons. It resumes where you left off and shows WebVTT subtitles in the device language.
- **Paywall:** the first *N* episodes are free, and each later one costs coins. The paywall opens on the locked episode itself and lets you top up and unlock in one flow.
- **Coins:** an append-only ledger, and coin packs sold as store consumables through RevenueCat. Purchases are verified server-side and idempotent per transaction, and unlocks are idempotent and can't double-spend under concurrency (per-user advisory lock). Purchases are saved on the device until the server credits them, so coins are never lost.
- **Discover:** search, genre chips, and Popular/New sorting.
- **My List:** continue watching.
- **Analytics:** funnel events (`feed_view`, `ep_start`, `ep_complete`, `paywall_view`, `purchase`, `unlock`) are batched to the backend.
- **Admin CMS:** create series and set free episodes and price, add episodes (HLS URL plus subtitles), publish or unpublish, manage coin packs, and see 24h stats.
- **Playback security:** the server decides access, and media URLs can be signed with an expiry for your CDN.

## Run the backend

With Docker:

```bash
docker compose up --build
# optional: sample series + coin packs (Postgres is exposed on localhost:5432)
(cd backend && npm install && DATABASE_URL=postgresql://kamixo:kamixo@localhost:5432/kamixo npm run seed)
```

Without Docker (Node 22 + PostgreSQL 16):

```bash
cd backend
cp .env.example .env          # edit DATABASE_URL etc.
npm install
npx prisma migrate deploy
npm run seed                  # optional sample data
npm run start:dev
```

- API: http://localhost:3000. Check it with `GET /health`.
- Admin CMS: http://localhost:3000/admin/. Enter the `ADMIN_API_KEY` value.

Tests (point `DATABASE_URL` at a **throwaway** database, because the e2e suite truncates tables):

```bash
npm test                                        # unit tests
DATABASE_URL=postgresql://.../kamixo_test npm run test:e2e
```

## Run the mobile app

```bash
cd mobile
flutter pub get
# Android emulator reaches your computer at 10.0.2.2; iOS simulator can use localhost
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

Without RevenueCat keys, the app uses a **sandbox store**: buying coins is free and only works when the backend runs with `PURCHASE_VERIFIER=sandbox`. Production config refuses the sandbox verifier.

### Turning on real payments

1. Create consumable products in App Store Connect and Google Play Console with ids that match your coin packs (the seed uses `coins_100`, `coins_500`, `coins_1000`, `coins_2500`).
2. Add them to a RevenueCat project.
3. Backend: set `PURCHASE_VERIFIER=revenuecat` and `REVENUECAT_SECRET_API_KEY=sk_...`.
4. App: `flutter run --dart-define=REVENUECAT_APPLE_KEY=appl_... --dart-define=REVENUECAT_GOOGLE_KEY=goog_...`

The app configures RevenueCat with `appUserID` set to the backend user id. The backend then confirms each transaction with RevenueCat before crediting coins.

## Video hosting

Episodes are HLS (`.m3u8`) URLs. Upload and transcode them with Mux, Cloudflare Stream, or AWS MediaConvert + CloudFront, then paste the URL in the admin CMS.

To stop people sharing links, set `PLAYBACK_SIGNING_SECRET`. Playback URLs then get `?exp=<unix>&sig=<hmac>`. The signature is `HMAC_SHA256(secret, "<directory path>:<exp>")`, so one token covers the playlist and its segments. Validate it at the CDN edge (Cloudflare Worker, or a token-auth rule), or swap `signMediaUrl` in `backend/src/playback/playback.service.ts` for your CDN's own signer.

## API overview

All user endpoints need `Authorization: Bearer <token>` from `POST /auth/guest`.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/guest` | `{deviceId}` → `{accessToken, user}` |
| GET | `/feed?offset&limit` | Series + playable episode 1 |
| GET | `/genres` | |
| GET | `/series?genre&q&sort=popular\|new&offset` | |
| GET | `/series/:id` | Episodes with `free`/`locked`, resume progress |
| GET | `/episodes/:id/playback` | `402 EPISODE_LOCKED {price}` if not unlocked |
| POST | `/episodes/:id/unlock` | Spends coins; `402 INSUFFICIENT_COINS {price, balance}` |
| GET | `/wallet` | Balance + recent ledger |
| GET | `/coin-packs` | |
| POST | `/wallet/purchases` | `{platform, productId, transactionId}` |
| PUT | `/progress` | `{seriesId, episodeNumber, positionSec}` |
| GET | `/me/continue-watching` | |
| POST | `/events` | `{events: [{name, props, ts}]}` |
| * | `/admin/...` | Header `x-admin-key` |

## Next: Phase 2

VIP subscriptions, rewarded-ad unlocks, daily check-in, push notifications, deep links from ads, and MMP attribution. See `docs/PLAN.md`.
