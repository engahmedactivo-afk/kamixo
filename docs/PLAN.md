# Kamixo: Plan for a Short-Drama (Micro-Drama) Streaming App

Reference product: **DramaWave** (SKYWORK AI, launched Sept 2024). It is a top-10
short-drama app worldwide, competing with ReelShort, DramaBox, NetShort and FreeReels.

---

## 1. How DramaWave works

### Product
- **Vertical (9:16) series.** Each episode runs about 1–3 minutes, and a series has 50–100+ episodes. Every episode ends on a cliffhanger.
- **TikTok-style feed.** The home screen is a full-screen swipe feed of trailers and first episodes. Tapping one opens the series player, and swiping up plays the next episode.
- **Discovery.** Genre tabs (CEO/billionaire romance, revenge, werewolf, mafia, family drama), rankings, "new", and "continue watching".
- **Localization at scale.** It uses AI dubbing and subtitles in many languages. This is SKYWORK's AI advantage: one Chinese or English production gets sold in 10+ markets.

### Monetization (hybrid)
| Layer | How it works |
|---|---|
| Free episodes | The first ~3–10 episodes of each series are free. This is the hook. |
| Coins | Locked episodes cost ~50–80 coins each, and the price rises deeper into a series. Coins are sold in packs through IAP. |
| Bonus coins | Earned from daily check-in, tasks (bind email, notifications on, share) and rewarded ads, with a daily cap. |
| Rewarded ads | Watch an ad to unlock one episode. This brings revenue from users who don't pay. |
| VIP subscription | Weekly or monthly. Unlocks all episodes and removes ads. Weekly is the money-maker. |
| Paywall timing | The paywall appears right at a cliffhanger, which is where conversion is highest. |

### Growth engine
- **Mostly paid user acquisition.** Over 80% of early downloads came from ads on TikTok, Meta and Google, built from the most dramatic clips.
- **Deep links.** Each ad deep-links to the exact series and episode it showed.
- **Tracking and retention.** It optimizes on ROAS using MMP attribution (AppsFlyer or Adjust), and runs push and remarketing to bring back users who dropped off at the paywall.

**Takeaway:** the app itself is not very complex. The business rests on **content supply, paywall/pricing optimization, and UA spend efficiency**.

---

## 2. Architecture

```
 Mobile app (Flutter or React Native)
   ├─ Feed / Player (HLS, preloading next episode)
   ├─ Store (StoreKit 2 / Google Play Billing via RevenueCat)
   └─ Ads SDK (AdMob / AppLovin MAX — rewarded)
            │ HTTPS/JSON
 API backend (NestJS or Go)  ── PostgreSQL (users, series, episodes, wallet ledger)
   ├─ Auth (guest + Apple/Google/Facebook login)
   ├─ Catalog & recommendations ── Redis (cache, rankings)
   ├─ Wallet / unlock service (idempotent coin ledger)
   ├─ Entitlements (VIP via RevenueCat webhooks)
   └─ Signed playback URLs
 Media pipeline: upload → transcode (AWS MediaConvert / Mux / Cloudflare Stream)
                 → HLS multi-bitrate → CDN (CloudFront / Cloudflare)
 AI localization: Whisper (ASR) → LLM translation → TTS / voice-clone dubbing → burned or soft subtitles
 Admin CMS (Next.js): series, episodes, pricing, free-episode count, banners, push
 Analytics: Firebase/Amplitude + AppsFlyer/Adjust; BigQuery for ROAS & funnel
```

### Core data model
- `users` (id, guest_device_id, auth_provider, country, locale)
- `series` (id, title, genre[], cover, total_eps, free_eps, price_per_ep, status)
- `episodes` (id, series_id, number, duration, hls_url, subtitles{lang:url})
- `wallet_ledger` (id, user_id, delta, type: purchase|bonus|unlock|refund, ref_id, created_at). Balance = SUM; never keep a mutable balance only.
- `unlocks` (user_id, episode_id, method: coins|ad|vip, unique)
- `subscriptions` (user_id, product, expires_at, source)
- `watch_progress` (user_id, series_id, episode_no, position)

### Critical rules
- Unlock checks happen **server-side**. Playback URLs are short-lived signed URLs, issued only when the user is entitled to the episode.
- Verify every IAP receipt server-side (RevenueCat simplifies this). Handle refunds by writing negative ledger entries.
- Preload the next episode's first segments so swipes feel instant. This is the #1 UX factor.

---

## 3. Build phases

### Phase 0: Foundations (week 1–2)
- Choose the stack (recommended: **Flutter + NestJS + Postgres + Mux/Cloudflare Stream + RevenueCat**).
- Register Apple/Google developer accounts and set up legal entity, privacy policy and terms.
- Start **content acquisition in parallel**. This is the real bottleneck (see §4).

### Phase 1: MVP (week 3–10) ✅ implemented, see README
1. Guest login → full-screen vertical feed → series player with episode list.
2. HLS playback, next-episode preload, continue-watching.
3. Free-episode gate + coin wallet + coin packs (IAP) + unlock flow.
4. Admin CMS: upload series, set free eps and price.
5. Subtitles (manual or AI) in 2–3 languages.
6. Analytics events: `feed_view, ep_start, ep_complete, paywall_view, purchase, unlock`.

### Phase 2: Monetization depth (week 11–16)
- VIP weekly/monthly subscriptions, rewarded-ad unlocks, daily check-in and tasks.
- Paywall A/B tests (price per ep, free-ep count, pack sizes, first-purchase discount).
- Push notifications ("new episodes", "you stopped at ep 12").
- Deep links from ads to a specific series and episode, plus MMP integration.

### Phase 3: Scale (month 5+)
- AI dubbing pipeline for 10+ languages.
- Recommendation model (collaborative filtering on watch-completion).
- Web version (SEO plus web payments via Stripe, which avoids the 15–30% store fee where allowed).
- Creator/studio portal with revenue share, and original productions.

---

## 4. Content strategy (the hardest part)
- **License** existing short dramas from Chinese/US producers (per-title fee or rev-share). This is the fastest route.
- **Produce** your own: typical budget $100k–$300k per US series, 7–10 shoot days. Script formula: hook in the first 10 seconds, a twist every episode, paywall placed at a big twist.
- **AI-assisted.** AI dubbing and translation multiplies each title across markets. AI-generated video dramas are emerging but still lower quality.
- **Niche option.** Pick an underserved market (for example **Arabic/MENA**) and produce or dub there first, instead of fighting ReelShort head-on in the US.

---

## 5. Team & rough cost (MVP)
| Role | Count |
|---|---|
| Mobile dev (Flutter) | 1–2 |
| Backend dev | 1 |
| Designer (UI/UX) | 1 (part-time) |
| Content/ops manager | 1 |
| Growth/UA marketer | 1 |

- **MVP build:** ~$30k–$80k (outsourced) or 3–4 months with a small in-house team.
- **Infrastructure:** video CDN and transcoding are the main cost. Budget $500–$3k per month early on, scaling with watch minutes.
- **Content:** $0 upfront with rev-share licensing, up to $100k+ per original series.
- **UA:** the biggest line item. Test with $5k–$20k and scale only if D7 ROAS looks healthy.

---

## 6. KPIs to track
- Feed → ep1 start rate, ep completion rate, **reach-paywall rate**
- Paywall → purchase conversion, first-purchase rate, ARPPU
- D1/D7/D30 retention, VIP renewal rate
- CPI, **D0/D7/D30 ROAS** (the main business metric)

## 7. Legal / store compliance
- Apple and Google require IAP for digital content inside the app. Show coin prices clearly and offer "restore purchases".
- Auto-renewing subscriptions need clear terms, and cancellation must be easy. Short-drama apps get many complaints about this.
- Hold content rights per territory and language, especially for dubbed versions.
- Add age ratings and moderation, plus GDPR/CCPA consent for ads and tracking (ATT on iOS).

## 8. Differentiate (don't just copy)
- Fairer pricing (cheaper bundles, "unlock whole series" option). This answers the #1 user complaint.
- A regional language focus (Arabic, Hindi, Indonesian, Turkish, etc.).
- Interactive or choose-your-path episodes, or community features (comments, polls on the next twist).
