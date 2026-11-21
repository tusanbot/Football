# Supabase PostgreSQL setup for Football Empire

Football Empire uses Supabase as a **managed PostgreSQL host**. Authentication, game rules, wallets, matches, leagues, group operations and administration remain in the Football Empire API. The Mini App must never connect directly to PostgreSQL.

## Connection variables

Configure these only on the server:

- `DATABASE_URL`: runtime PostgreSQL connection used by the API / Prisma adapter.
- `DIRECT_URL`: direct or session-pooled PostgreSQL connection used by Prisma CLI for schema validation and migrations.

For local development, both may point to the same local PostgreSQL database. In Supabase, copy the runtime and migration connection strings from the project's Connect panel and keep their roles separate. Prefer a direct connection for migrations; if the host cannot reach Supabase's IPv6 direct endpoint, use Supabase's session pooler for `DIRECT_URL`. Do not run Prisma schema migrations through a transaction pooler.

For the Cloudflare API Worker, use Hyperdrive as the runtime connection layer where configured; the Worker already maps its Hyperdrive binding to Prisma's runtime `DATABASE_URL`. The migration command still runs from a trusted development environment with `DIRECT_URL`.

## Security boundaries

- Never put either connection string in `NEXT_PUBLIC_*`, browser code, Mini App configuration, Telegram messages, or source control.
- Do not expose the database to the browser. All reads and writes must pass through the authenticated Football Empire API.
- Do not enable anonymous database access for game tables. Do not rely on client-side Row Level Security as a substitute for API authorization.
- Use a dedicated database password and rotate it if it is exposed.
- Keep production and development Supabase projects separate. Do not point development CI or local tests at production.

This repository does not use Supabase Auth, the Supabase REST API, or an `anon` / `service_role` key for game operations. It connects to PostgreSQL through the server-side `pg` driver.

## First database initialization

Run these commands from the repository root after setting both URLs in the local server environment:

```bash
pnpm install
pnpm db:generate
pnpm --filter @football/api exec prisma validate
pnpm db:migrate:deploy
pnpm --filter @football/api db:seed:special
```

The migrations create the game schema. The seed command is idempotent and installs the curated special-player catalog. Do not use `prisma db push` against a shared or production database; committed migrations are the source of truth.

Then start the API and verify:

- `GET /health` returns HTTP 200.
- `GET /ready` returns HTTP 200 only after required configuration and PostgreSQL connectivity are valid.
- Bot startup succeeds only after API readiness and Bot-token identity verification.
- The Bot and Mini App can create/load the same Telegram account and primary club.

## Before real users

Test both Telegram clients against the same non-production project and verify account provisioning, wallet ledger, transfers, match settlement, league progression, group rewards, gift redemption, admin audit events, and retry queues. Confirm backup restoration and monitoring before switching any real users to the database.

The CI pipeline validates every committed Prisma migration against an ephemeral PostgreSQL 16 database. A successful CI run does not create a Supabase project, apply migrations to it, verify real Telegram credentials, or constitute production approval.
