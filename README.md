# Kamixo

A short-drama (micro-drama) streaming app: vertical episodes of 1–3 minutes, a few free episodes per series, and coins to unlock the rest. See [`docs/PLAN.md`](docs/PLAN.md) for the product analysis and roadmap.

**Status: Phase 1 (MVP) and Phase 2 (monetization depth) are implemented.**

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

## Features in Phase 2

- **VIP subscriptions:** weekly/monthly plans; VIP users watch everything without coins. Purchases go through RevenueCat, and the backend also listens to RevenueCat **webhooks**, so coins and VIP are applied even if the app never reported the purchase. "Restore purchases" is supported.
- **Watch an ad to unlock:** rewarded ads with a daily cap (`AD_UNLOCK_DAILY_CAP`). With AdMob the backend verifies Google's signed **server-side verification** callback before granting anything; in development a sandbox "ad" is shown instead.
- **Daily check-in and tasks:** streak-based coin bonuses (10, 10, 15, 15, 20, 25, 40) and one-time tasks (turn on notifications, share the app, finish a series).
- **Push notifications:** FCM HTTP v1 (service account, no SDK). Admin broadcast, automatic "new episode" alerts to everyone who started that series, and "you stopped at episode N" come-back reminders.
- **Deep links:** `kamixo://series/<id>?ep=N` opens the app on that episode; the backend serves a share/ad landing page at `/s/<id>?ep=N` that redirects into the app. Ads should link to that page.
- **Remote config and A/B tests:** first-purchase bonus, which paywall tab shows first, and named experiments whose variant is assigned per user and attached to every analytics event.

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

### Phase 2 integrations

| Integration | Backend `.env` | App `--dart-define` |
|---|---|---|
| RevenueCat webhook | `REVENUECAT_WEBHOOK_SECRET` (same value as the Authorization header configured in the RevenueCat dashboard; URL `<PUBLIC_BASE_URL>/webhooks/revenuecat`) | – |
| AdMob rewarded ads | `AD_REWARD_VERIFIER=admob`; set the SSV callback URL in AdMob to `<PUBLIC_BASE_URL>/webhooks/admob/ssv` | `ADMOB_REWARDED_ANDROID`, `ADMOB_REWARDED_IOS` (ad unit ids). Replace the test **app ids** in `AndroidManifest.xml` and `Info.plist`. |
| Push (FCM) | `FCM_SERVICE_ACCOUNT_JSON` (Firebase service-account JSON on one line) | `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_SENDER_ID`, `FIREBASE_PROJECT_ID` (from the Firebase console). On iOS also upload your APNs key to Firebase. |
| Deep links | `PUBLIC_BASE_URL`, `APP_URL_SCHEME` | Custom scheme is already registered. For `https://` App Links / Universal Links, set your host in `AndroidManifest.xml` and add Associated Domains in Xcode, then publish `assetlinks.json` / `apple-app-site-association` on that host. |
| Come-back reminders | daily cron: `curl -X POST -H "x-admin-key: $ADMIN_API_KEY" <PUBLIC_BASE_URL>/admin/push/reminders` | – |

Without any of these set, everything still works in **sandbox** mode (fake ads, free VIP, no push), and the backend refuses sandbox verifiers in production (`NODE_ENV=production`).

**Attribution / MMP:** add the AppsFlyer or Adjust SDK to the app and have your ad campaigns point at `/s/<seriesId>?ep=N` (or an MMP OneLink that forwards to it). The `session_start` event carries the experiment variants, so ROAS can be split by variant.

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
| GET | `/me` | Balance, VIP status, ad allowance |
| GET | `/config` | Remote config + experiment variants |
| GET/POST | `/subscriptions/plans`, `/subscriptions/me`, `/subscriptions/sync` | VIP |
| GET/POST | `/ads/usage`, `/episodes/:id/unlock-with-ad` | Rewarded ads (sandbox) |
| GET/POST | `/rewards`, `/rewards/check-in`, `/rewards/tasks` | Daily check-in, tasks |
| POST | `/me/push-token` | `{token, platform}` |
| GET | `/s/:id?ep=N` | Public share / deep-link page |
| POST | `/webhooks/revenuecat`, GET `/webhooks/admob/ssv` | Store / ad callbacks |
| * | `/admin/...` | Header `x-admin-key` (series, episodes, coin packs, VIP plans, push, settings) |

## Next: Phase 3

AI dubbing pipeline, recommendations, a web player with Stripe payments, and a studio/creator portal. See `docs/PLAN.md`.
