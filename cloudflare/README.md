# Football Empire — Cloudflare migration foundation

This directory is the non-production Cloudflare deployment foundation. Nothing in this directory is deployed automatically.

## Approved target

- Mini App: Cloudflare Workers, initially through the maintained Next.js adapter path.
- Game API: Cloudflare Workers.
- Primary database: Cloudflare D1 (SQLite).
- Telegram Bot: grammY webhook on Workers; the current polling process is not used in the target runtime.
- Durable asynchronous work: Queues, with Workflows / Durable Object Alarms where the job lifecycle requires them.
- Images and uploaded club logos: R2.
- Short-lived, non-authoritative cache: KV.
- Match coordination: Durable Objects only for coordination/state that does not replace authoritative D1 records.

## Important migration gates

The current API is not deployable on D1 by changing a connection string:

1. `apps/api/prisma/schema.prisma` currently uses Prisma 6.5 and the PostgreSQL provider. The schema has 56 models and 27 enums, plus PostgreSQL-specific native field annotations.
2. The game services use Prisma transactions for wallet changes, ledger entries, player transfers, competition creation and other multi-record operations.
3. Prisma's D1 adapter for Prisma ORM v6 does not provide ACID transactions: Prisma documents that implicit and explicit transactions are ignored and individual statements run separately. Do not use it for the current economy services.
4. D1's native `batch()` API executes statements sequentially as a transaction. Critical write paths must be moved to a D1-native repository using `batch()` plus conditional updates/idempotency checks, or to another proven atomic design, before any production traffic is routed to D1.
5. D1 databases are single-threaded per database and have a hard 10 GB maximum on Workers Paid. A single global game database therefore needs realistic concurrency, write throughput, storage-growth and backup/restore tests.

The Cloudflare API Worker scaffold intentionally exposes health checks only. `/ready` remains unavailable until the full game schema, repository layer, auth and game routes have been migrated. All `/v1/*` routes fail closed with HTTP 503; this is deliberate and prevents a partially migrated Worker from being mistaken for a working game API.

## Current API Worker scaffold

1. Create a D1 database in the Cloudflare dashboard or with Wrangler.
2. Copy its ID into `cloudflare/api/wrangler.jsonc` (replace the placeholder).
3. Apply the bootstrap migration locally and remotely only after selecting the intended development database:

```bash
pnpm dlx wrangler d1 migrations apply football-empire-dev --local --config cloudflare/api/wrangler.jsonc
pnpm dlx wrangler d1 migrations apply football-empire-dev --remote --config cloudflare/api/wrangler.jsonc
```

4. Run locally:

```bash
pnpm dlx wrangler dev --config cloudflare/api/wrangler.jsonc
```

5. Do not run `wrangler deploy` yet. The game API is deliberately not ready.

## Planned bindings

| Binding | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 | Authoritative game records |
| `GAME_EVENTS` | Queue | Durable game events |
| `BOT_UPDATES` | Queue | Telegram update processing |
| `ASSETS` | R2 | Club logos and uploaded assets |
| `CACHE` | KV | Non-authoritative cache |
| `MATCH_COORDINATOR` | Durable Object | Per-match coordination |

Bindings are added only when their consumer is implemented and tested. Do not create placeholder production secrets or point a Telegram webhook at an unfinished worker.

## Environment / secrets to prepare later

Worker secrets (never commit values):
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `BOT_API_SECRET` (temporary compatibility secret while Bot/API authentication is migrated)
- `GAME_ADMIN_TELEGRAM_IDS`

Non-secret Worker variables:
- `MINI_APP_ORIGIN`
- `PUBLIC_API_ORIGIN`
- `TELEGRAM_WEB_APP_URL`
- `ENVIRONMENT` (use `development` for the initial D1 database)

The Mini App's `NEXT_PUBLIC_API_URL` is a build-time public value, not a secret.

## Migration order

1. D1 schema conversion and schema-parity review against all PostgreSQL migrations.
2. D1-native repository and transaction primitives; prove atomic wallet/ledger operations and idempotency under concurrent requests.
3. Port API auth, rate limits and all game routes; keep the Worker readiness gate closed until all required routes are present.
4. Port grammY command registration to a Worker-safe bot factory; add webhook verification, update de-duplication and Queue processing. Remove polling lease and interval workers only after parity tests pass.
5. Port Mini App with a compatible Next.js adapter; run the adapter compatibility check before changing the production build.
6. Move delayed notifications, group-message deletion and match progression to Queues / Workflows / Durable Object Alarms.
7. Import a verified PostgreSQL snapshot into D1 in batches, reconcile row counts and financial ledger totals, then run shadow and load tests.
8. Only after explicit approval: configure Telegram webhook, switch public DNS/routes and retire PostgreSQL polling infrastructure.

## Safety

- No production deployment is configured by this scaffold.
- No production database is created or modified by repository changes.
- PostgreSQL remains the current source of truth until a separately approved cutover.
- Never enable Telegram webhook delivery until the Worker can execute every existing command and can durably process retries without duplicate side effects.
