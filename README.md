# Football Empire

A Telegram-first football management MMO. Telegram Bot, Telegram Mini App and Telegram group competitions are clients of one game platform.

## Architecture decision (mandatory)

**Supabase PostgreSQL is the independent database platform for this project. Prisma and Cloudflare Hyperdrive are not permitted in the bot, API, Mini App, persistence layer, migrations, or deployment architecture.** Do not introduce them in new code, dependencies, scripts, documentation, or infrastructure. The server-side API connects to Supabase directly using the supported PostgreSQL driver; Bot and Mini App use the same API and never connect to the database directly. Do not use a Cloudflare Worker/Hyperdrive path for database access.

This is the target architecture and a binding rule for all future work. The current repository still contains legacy Prisma-based persistence and migration files; they are not evidence that Prisma remains approved. Complete removal and conversion to Supabase-native SQL/migrations and `pg`-based access is a required migration task. Until that migration is verified, do not claim the repository is fully Prisma-free or production-ready.

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

- Fastify API with Telegram Mini App initData HMAC verification, short-lived signed API sessions (12-hour expiry), Bot-to-API shared-secret authentication, and database-backed rate limits for sensitive operations.
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
- Deterministic 90-minute match engine with persisted simulation version and reproducible seeds, tactical/player/coach inputs, expected goals, score, chronological goal/card/injury/substitution events, up to seven bench players, automatic role-compatible substitutions, realistic minutes played, per-player ratings and match statistics.
- Friendly fixtures with opponent discovery, scheduled kickoff, participant-only simulation, post-match fitness/injury effects, attendance, ticket revenue, reputation and Cash rewards.
- Round-robin league registration for 4–10 clubs, owner-controlled league start, automatic fixture generation, live standings (3/1/0 points), goal difference and season completion.
- Match results and rewards settle atomically with wallet ledger and club finance entries; repeat simulation cannot duplicate results or payments.
- Lazy, idempotent UTC daily settlement for fitness recovery, injury return, morale, contract countdown, annual ageing, listing expiry and weekly payroll.
- Special-player catalog (curated real-world footballers) with rarity, gameplay ratings and acquisition-method metadata.
- Gold-priced Epic, Legendary and Icon packs with server-side random selection, per-club ownership limits, atomic wallet debit, acquisition history and immutable ledger entries.
- Idempotent special-player catalog seed command.
- Transfer market for generated players: create/cancel listings, expiry handling, atomic purchase, player ownership transfer and buyer/seller ledger entries.
- Persian RTL Mini App: browse listings, sell owned players, manage own listings, view the special-player catalog, configure starting XI/formation/tactics, and manage player training, fitness, morale, injuries, contracts and payroll, schedule friendlies, use the live match center for score/timeline/checkpoint decisions and substitutions, create/join leagues and knockout cups, and inspect standings, brackets and match reports.
- Telegram bot commands: `/legendsdraft TELEGRAM_USER_ID` (create a two-player Legends Draft invitation in private chat or a group; both participants complete picks, formations and match result in the shared Mini App), `/start` (Bot-only account/club creation and Mini App launch button), `/miniapp` (open the Telegram Mini App in a private chat), `/club`, `/wallet`, `/rename`, `/players`, `/lineup`, `/setlineup`, `/development`, `/train PLAYER_ID FOCUS INTENSITY`, `/renew PLAYER_ID DAYS WEEKLY_WAGE`, `/operations`, `/finance`, `/upgrade`, `/ticket-price`, `/scout`, `/recruit`, `/sponsor`, `/coach-upgrade`, `/hire-coach`, `/opponents`, `/friendly`, `/matches`, `/play`, `/league`, `/cup`, `/leagues`, `/joinleague`, `/tactic`, `/sub`, `/startleague`, `/startcup`, `/table`, `/market`, `/sell PLAYER_ID PRICE`, `/buy LISTING_ID`, `/special`, and `/pack`.
- Telegram group operations: verified group registration and membership synchronization, member-threshold checks, daily/game activity points, group treasury and personal reward balances, group shop, challenges, local leagues, and alliance competitions.
- National seven-tier league pyramid with eight-team league creation, application queues, promotion/relegation offers, opt-out and replacement handling, season awards, and durable Bot notices.
- Semi-active match runtime with persisted checkpoints, tactical decisions, fallback plans, five-substitution limit including half-time, suspensions, match notifications and retryable delivery queues.
- Central admin API and Mini App panel for scoped roles, game settings, players, clubs, groups, competitions, moderation, gifts, wallet/group ledger adjustments, finance reports, awards, audit logs and durable broadcasts.
- Durable group-message deletion queue (60-second default), with exceptions for persistent group replies; durable retry queues for user and group notifications.
- Telegram polling is protected by a PostgreSQL lease: only one Bot process per database may own polling at a time; the lease is renewed every 15 seconds and expires automatically after process loss.
- Both clients use the same authenticated API; the Bot does not implement game/economy rules.

## Infrastructure direction

The project uses Supabase PostgreSQL independently, without Cloudflare Hyperdrive. Cloudflare Worker/database connectivity is not part of the approved architecture. Existing legacy Cloudflare/Prisma references are historical and must not be used as implementation guidance; update or remove them as the Supabase-only migration is completed.

## Delivery status

The core gameplay, economy, match lifecycle, league pyramid, group competitions, administration and Bot/Mini App integration are implemented on the development branch. This is still a development release, not a production launch declaration: CI verifies schema migration, seed integrity, TypeScript, automated tests and production builds, but it cannot verify a real BotFather token, Telegram group permissions, live Telegram delivery, production database backups, or behavior under production traffic.

The remaining release gates are operational: configure real secrets and HTTPS origins, apply migrations to the intended database, grant the Bot administrator rights in each participating group, run live end-to-end checks through both Telegram clients, validate backup/restore, and complete production load/monitoring checks.

## Runtime configuration

Set these values in the API and Bot runtime environments:

- `BOT_API_SECRET` — a long random secret shared only by the API and bot. Generate one with `openssl rand -hex 32`. Never expose it to the Mini App or browser.
- `FOOTBALL_API_URL` — API base URL used by the bot.
- `TELEGRAM_BOT_TOKEN` — bot token, also used by the API to verify Mini App `initData`.
- `TELEGRAM_WEB_APP_URL` — public Mini App URL used by the bot launch button.

Set these values for the web app:

- `NEXT_PUBLIC_API_URL` — public HTTPS API base URL used by the Mini App.
- `CORS_ORIGIN` — comma-separated allowed web origins for the API.

The Mini App exchanges fresh Telegram-signed initData at POST /v1/auth/telegram. The API verifies the HMAC and timestamp (five-minute maximum age), provisions the account if needed, and returns a signed bearer session that expires after 12 hours. Web clients keep that session in memory and tab-scoped session storage, validate cached sessions through the API on page navigation, and send it as Authorization: Bearer; the Bot API secret is never sent to the browser. If the initial Telegram data has expired, the user must reopen the Mini App from Telegram to obtain fresh initData.

Bot-to-API requests use BOT_API_SECRET plus the Telegram sender ID; keep the secret server-side and use HTTPS between services in production. The same secret signs Mini App sessions, so rotating it invalidates existing sessions. The Bot's private /start command provisions the same account/club through /v1/auth/bot; it does not require the user to open the Mini App. The Bot runs in long-polling mode and refuses to start if Telegram reports an existing webhook; it never silently changes the Bot's webhook configuration. Run one Bot process per database; a second process is rejected until the active lease is released or expires.

## Database setup

Supabase PostgreSQL is the sole approved persistent database. The API connects server-side using the PostgreSQL `pg` driver and server-only credentials. The Mini App and Telegram Bot call the same API; neither client receives database credentials or connects directly to Supabase.

Use Supabase-native SQL migrations and reviewed SQL scripts as the schema source of truth. Do not use Prisma schema, Prisma Client, Prisma CLI, `DIRECT_URL` migration workflows, or Hyperdrive. Keep development/staging and production Supabase projects separate. The repository still has legacy Prisma artifacts that must be migrated and removed before the implementation can be described as fully converted.

## Local development

1. Install Node.js 22+ and pnpm 10+.
2. Copy `.env.example` to `.env`, configure the values above, and set a unique `BOT_API_SECRET`.
3. Start infrastructure: `docker compose up -d`.
4. Install dependencies: `pnpm install`.
6. Start services: `pnpm dev`.

## Pre-production checklist

1. Configure server-only Supabase PostgreSQL credentials and the required Telegram/API environment values. Never expose database credentials to the Mini App.
2. Apply the reviewed Supabase-native SQL migrations to the intended non-production project; verify schema and seed procedures before any production rollout. Do not run Prisma commands.
3. Start the API and confirm GET /ready returns HTTP 200 before starting the Bot.
4. Start exactly one Bot process for that database. It verifies the Bot token against the API, confirms no webhook is configured, acquires the database polling lease, starts long polling, and renews the lease. Do not configure a webhook for this polling deployment; if one is already configured, resolve it explicitly in Telegram before starting the Bot.
5. Open the Mini App through Telegram and test onboarding, wallet, player management, match checkpoints/fallback, competitions, group membership, gifts and admin permissions. Test Bot commands and Mini App actions against the same test accounts.
6. Verify Bot administrator rights in every group, including the ability to query member status/count and delete the Bot's own temporary messages.
7. Verify backup restoration, structured logs/alerts, queue retry behavior and load/concurrency limits before production traffic.

Do not treat a successful CI run as evidence that Telegram credentials, live group permissions, external networking, production secrets or deployment are configured.


## Seasonal player awards archive

- Public API: `GET /v1/seasons/:season/awards` aggregates completed official competition matches for the requested season.
- Seasonal awards include top scorer, top assist provider, player of the season (minimum appearances configurable from 1 to 38; default 3), and a 4-3-3 team of the season selected by average match rating.
- Bot command: `/seasonawards [YEAR]`.
- Mini App page: `/season-awards`.
- The archive is derived from immutable completed-match performance records; no separate award payout or migration is required.
