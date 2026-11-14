# Football Empire

A Telegram-first football management MMO. Telegram Bot, Telegram Mini App and Telegram group competitions are clients of one game platform.

## Monorepo

- `apps/api` — authoritative game API (Fastify) and server-side application services.
- `apps/bot` — Telegram Bot client (grammY); it calls the same API as the Mini App.
- `apps/web` — Next.js Telegram Mini App and web client.
- `packages/domain` — shared game contracts and pure domain/economy rules.
- PostgreSQL — persistent game state and immutable financial ledger.
- Redis — planned for queues, rate limits, sessions and live coordination.

## Non-negotiable invariants

1. One Telegram identity maps to one game account and one primary club.
2. Bot and Mini App use the same API and application commands; no client-side authoritative rules.
3. Group membership never owns or duplicates a club or wallet.
4. Balances change only through server-side ledger transactions.
5. Economy mutations are atomic and idempotent.
6. Match results and rewards are auditable and applied once.
7. A user can play without joining a Telegram group.

## Implemented foundation

- Fastify API, Telegram Mini App `initData` HMAC validation and Telegram bot-to-API shared-secret authentication.
- Shared Telegram account provisioning service used by both Mini App `initData` and authenticated Bot onboarding (`/start`); creates the primary club, Cash/Gold wallets, starter ledger grants and 18-player squad atomically.
- Generated starter squad, automatic strongest-available 4-3-3 starting XI, and authenticated squad/wallet/profile APIs.
- Server-validated starting XI management with 4-3-3, 4-4-2, 3-5-2 and 4-2-3-1 formations, tactical presets, ownership/position validation and optimistic version checks.
- Player development lifecycle: focus-based daily training, intensity/cost, potential- and age-weighted progression, positional overall ratings, fatigue, injury risk, coach training/recovery/medical effects, morale, recovery, annual ageing and retirement.
- Contract management with 90/180/365-day renewals, server-calculated acceptable weekly wage ranges, expiry/suspension, and idempotent renewal history.
- Weekly player/coach payroll with pro-rated contract expiry, atomic Cash debit and ledger record, wage arrears carry-forward, and morale penalties when payroll cannot be fully paid.
- Club facilities: stadium capacity and ticket-price configuration, training-ground and academy upgrades, upgrade costs, and daily maintenance accrual.
- Youth academy: paid scouting generates three age-16–18 prospects; prospects have attributes, potential and recruitment costs, and can be recruited into the first team through an atomic wallet/ledger transaction.
- Coach operations: hire from specialist candidate profiles or invest in coach progression; skills affect training, recovery and injury prevention, and salary changes feed into payroll.
- Sponsor contracts with reputation/level-gated offers, signing bonuses, daily income, expiry and idempotent accrual.
- Club finance statements with categorized income/expense entries for training, academy, facilities, coaches, sponsorship, transfer purchases/sales and paid weekly payroll; daily operating arrears and immutable Cash ledger movements.
- Deterministic 90-minute match engine with reproducible seeds, tactical/player strength inputs, expected goals, score, chronological goal/card/injury events, per-player ratings and match statistics.
- Friendly fixtures with opponent discovery, scheduled kickoff, participant-only simulation, post-match fitness/injury effects, attendance, ticket revenue, reputation and Cash rewards.
- Round-robin league registration for 4–10 clubs, owner-controlled league start, automatic fixture generation, live standings (3/1/0 points), goal difference and season completion.
- Match results and rewards settle atomically with wallet ledger and club finance entries; repeat simulation cannot duplicate results or payments.
- Lazy, idempotent UTC daily settlement for fitness recovery, injury return, morale, contract countdown, annual ageing, listing expiry and weekly payroll.
- Special-player catalog (curated real-world footballers) with rarity, gameplay ratings and acquisition-method metadata.
- Gold-priced Epic, Legendary and Icon packs with server-side random selection, per-club ownership limits, atomic wallet debit, acquisition history and immutable ledger entries.
- Idempotent special-player catalog seed command.
- Transfer market for generated players: create/cancel listings, expiry handling, atomic purchase, player ownership transfer and buyer/seller ledger entries.
- Persian RTL Mini App: browse listings, sell owned players, manage own listings, view the special-player catalog, configure starting XI/formation/tactics, and manage player training, fitness, morale, injuries, contracts and payroll, schedule friendlies, simulate due matches, create/join leagues and inspect standings and match reports.
- Telegram bot commands: `/start` (Bot-only account/club creation), `/club`, `/wallet`, `/rename`, `/players`, `/lineup`, `/setlineup`, `/development`, `/train PLAYER_ID FOCUS INTENSITY`, `/renew PLAYER_ID DAYS WEEKLY_WAGE`, `/operations`, `/finance`, `/upgrade`, `/ticket-price`, `/scout`, `/recruit`, `/sponsor`, `/coach-upgrade`, `/hire-coach`, `/opponents`, `/friendly`, `/matches`, `/play`, `/league`, `/leagues`, `/joinleague`, `/startleague`, `/table`, `/market`, `/sell PLAYER_ID PRICE`, `/buy LISTING_ID`, `/special`, and `/pack`.
- Both clients use the same authenticated API; the bot does not implement game/economy rules.

The project is still an early development foundation, not a production-ready game. The club-operations foundation now includes facilities, academy, coach hiring/progression, sponsor income, maintenance, ticket-price settings and financial statements. The initial match engine, friendly lifecycle, round-robin leagues and matchday gate receipts are now implemented. Two-leg cups, promotion/relegation, full season administration, substitutions, advanced match commentary, complete group competitions, admin controls, and comprehensive economy/security/load testing remain in development.

## Runtime configuration

Set these values in the API and Bot runtime environments:

- `BOT_API_SECRET` — a long random secret shared only by the API and bot. Generate one with `openssl rand -hex 32`. Never expose it to the Mini App or browser.
- `FOOTBALL_API_URL` — API base URL used by the bot.
- `TELEGRAM_BOT_TOKEN` — bot token, also used by the API to verify Mini App `initData`.
- `TELEGRAM_WEB_APP_URL` — public Mini App URL used by the bot launch button.

Set these values for the web app:

- `NEXT_PUBLIC_API_URL` — public HTTPS API base URL used by the Mini App.
- `CORS_ORIGIN` — comma-separated allowed web origins for the API.

The Mini App authenticates with Telegram's signed `initData`. Bot requests use the shared `BOT_API_SECRET` plus the Telegram sender ID; keep the secret server-side and use HTTPS between services in production. The Bot's private `/start` command provisions the same account/club through `/v1/auth/bot`; it does not require the user to open the Mini App.

## Database setup

1. Configure `DATABASE_URL` for PostgreSQL.
2. Apply committed migrations with `pnpm db:migrate:deploy`.
3. Seed the curated special-player catalog with `pnpm --filter @football/api db:seed:special`.

The seed is safe to rerun: it upserts catalog records by stable slug. Run migrations and seed only against the intended development/staging database until a production rollout is explicitly approved.

## Local development

1. Install Node.js 22+ and pnpm 10+.
2. Copy `.env.example` to `.env`, configure the values above, and set a unique `BOT_API_SECRET`.
3. Start infrastructure: `docker compose up -d`.
4. Install dependencies: `pnpm install`.
5. Generate Prisma Client: `pnpm db:generate`.
6. Start services: `pnpm dev`.

## Remaining development sequence

1. Complete club facilities, academy, coach progression, sponsorship, and revenue/expense statements.
2. Match simulation, fixtures, leagues, tournaments, and group challenges.
3. Complete remaining Bot/Mini App parity and group operations.
4. Security, economy simulation, concurrency, and load testing before any production release.
