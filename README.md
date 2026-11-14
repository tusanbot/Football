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
- User onboarding, primary club, Cash/Gold wallets and ledger foundation.
- Generated starter squad and authenticated squad/wallet/profile APIs.
- Special-player catalog (curated real-world footballers) with rarity, gameplay ratings and acquisition-method metadata.
- Gold-priced Epic, Legendary and Icon packs with server-side random selection, per-club ownership limits, atomic wallet debit, acquisition history and immutable ledger entries.
- Idempotent special-player catalog seed command.
- Transfer market for generated players: create/cancel listings, expiry handling, atomic purchase, player ownership transfer and buyer/seller ledger entries.
- Persian RTL Mini App market interface: browse listings, sell owned players, manage own listings, view special-player catalog and Cash balance.
- Telegram bot commands: `/players`, `/market`, `/sell PLAYER_ID PRICE`, `/buy LISTING_ID`.
- Both clients use the same authenticated API; the bot does not implement game/economy rules.

The project is still an early development foundation, not a production-ready game. Group competitions, match simulation, special-player acquisition/reward execution, and comprehensive economy/security/load testing remain in development.

## Transfer-market configuration

Set these values in the API and Bot runtime environments:

- `BOT_API_SECRET` — a long random secret shared only by the API and bot. Generate one with `openssl rand -hex 32`. Never expose it to the Mini App or browser.
- `FOOTBALL_API_URL` — API base URL used by the bot.
- `TELEGRAM_BOT_TOKEN` — bot token, also used by the API to verify Mini App `initData`.
- `TELEGRAM_WEB_APP_URL` — public Mini App URL used by the bot launch button.

Set these values for the web app:

- `NEXT_PUBLIC_API_URL` — public HTTPS API base URL used by the Mini App.
- `CORS_ORIGIN` — comma-separated allowed web origins for the API.

The Mini App authenticates with Telegram's signed `initData`. Bot requests use the shared `BOT_API_SECRET` plus the Telegram sender ID; keep the secret server-side and use HTTPS between services in production.

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

1. Complete special-player acquisition flows and reward issuance.
2. Match simulation, fixtures, leagues, tournaments and group challenges.
3. Full feature parity for remaining game actions across Bot and Mini App.
4. Security, economy, concurrency and load testing before any production release.
