# Football Empire

A Telegram-first football management MMO. Telegram Bot, Telegram Mini App and Telegram group competitions are clients of one game platform.

## Monorepo

- `apps/api` — authoritative game API (Fastify) and server-side application services.
- `apps/bot` — Telegram Bot client (grammY); it must not own game/economy rules.
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

## Current foundation

- Monorepo and service boundaries.
- Fastify API health/version endpoints.
- Telegram Bot bootstrap with a Mini App launch button.
- Next.js Mini App shell.
- PostgreSQL/Prisma initial identity, club, wallet, ledger and Telegram-group schema.
- Telegram Mini App `initData` HMAC validation helper (server-side).
- Pure balance and idempotency guards in the shared domain package.

This is a foundation scaffold, not a playable release. Authentication endpoints, account onboarding, club creation, transactional wallet services, players, match simulation and group competitions remain to be implemented.

## Local development

1. Install Node.js 22+ and pnpm 10+.
2. Copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN`.
3. Start infrastructure: `docker compose up -d`.
4. Install dependencies: `pnpm install`.
5. Generate Prisma Client: `pnpm db:generate`.
6. Start services: `pnpm dev`.

## Development sequence

1. Identity/authentication and club onboarding.
2. Transactional wallet + immutable ledger.
3. Players, squad, training and facilities.
4. Match engine, fixtures, leagues and tournaments.
5. Group challenges, leaderboards and group administration.
6. Full feature parity across Bot and Mini App, then security/economy/load testing.
