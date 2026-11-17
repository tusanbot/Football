# Football Empire — Cloudflare runtime

This branch prepares two independent Cloudflare Workers:

1. **Web / Telegram Mini App** — the existing Next.js 15 application, built with the OpenNext Cloudflare adapter.
2. **Game API** — the existing Fastify API and Prisma domain services, executed inside a Worker with Node.js compatibility and PostgreSQL connectivity.

The API Worker reuses the same Fastify route registration and Prisma domain code as the current Node.js API. This avoids a second, incomplete implementation of game rules and preserves existing PostgreSQL transaction semantics while the D1 migration is validated separately.

## Database architecture

The game API remains PostgreSQL-backed. Cloudflare Workers connect **directly to Supabase's shared Transaction Pooler** over TLS using the server-side `DATABASE_URL` secret. Hyperdrive is not part of the target runtime and no `HYPERDRIVE` binding is required.

The Worker creates a request-scoped Prisma Client using `@prisma/adapter-pg`, `pg`, and Prisma's JavaScript engine. AsyncLocalStorage isolates concurrent requests. The Node.js API uses the same adapter with its normal process-scoped client.

This is a compatibility runtime, not a D1 cutover. The generated D1 schema and D1-native economy repositories remain migration work and are not used for live game traffic. D1 readiness must not be claimed until every API domain, transaction, idempotency rule, route, and background job has been ported and proven against D1.

## Cloudflare dashboard setup

Connect both Workers to repository `tusanbot/Football`, branch `feat/supabase-preflight-hardening`:

| Setting | Web / Mini App | Game API |
| --- | --- | --- |
| Root directory | `apps/web` | `cloudflare/api` |
| Wrangler config | `wrangler.jsonc` | `wrangler.jsonc` |
| Worker name | `football-empire-web-dev` | `football-empire-api-dev` |
| Build command | `pnpm build:worker` | `pnpm check:worker` |
| Local preview | `pnpm preview:worker` | `pnpm dev` |
| Deploy command | `echo "Deployment disabled until approved"` | `echo "Deployment disabled until approved"` |
| Non-production branch deploy | `echo "Preview deployment disabled until approved"` | `echo "Preview deployment disabled until approved"` |

**Important:** Cloudflare Workers Builds defaults its deploy command to `npx wrangler deploy`. Set the safe `echo` commands above in Settings → Builds for both Workers; otherwise a connected Git push may deploy automatically. Keep the connected branch set to `feat/supabase-preflight-hardening`. Do not enable automatic preview deployment yet.

Do not run Wrangler from the monorepo root. Each Worker needs its own root directory.

## Web / Mini App Worker

The Web Worker uses OpenNext. Configuration is in `apps/web/wrangler.jsonc` and `apps/web/open-next.config.ts`. It enables `nodejs_compat`, uses the generated `ASSETS` binding, and enables observability/source maps.

Set this build variable in the Web Worker:

- `NEXT_PUBLIC_API_URL`: HTTPS origin of the deployed Game API Worker, without path, query, fragment, username, or password.

This is public and compiled into the Mini App. Never use `NEXT_PUBLIC_*` for `BOT_API_SECRET`, `TELEGRAM_BOT_TOKEN`, or database credentials.

Preview from repository root:

```bash
pnpm install
pnpm --dir apps/web typecheck
pnpm --dir apps/web preview:worker
```

Preview builds OpenNext output and runs it locally; it does not deploy.

## Game API Worker

The API Worker imports the existing Fastify application and all route registrations. It adapts Fetch API requests through Fastify's injection interface.

Required secrets:

- `DATABASE_URL`: Supabase shared Transaction Pooler connection string copied from the Supabase Dashboard → Connect → Transaction pooler. It must use port `6543`, `pgbouncer=true`, and `sslmode=require`.
- `TELEGRAM_BOT_TOKEN`: used by Telegram Mini App init-data verification.
- `BOT_API_SECRET`: same server-to-server secret used by the existing Bot; at least 32 random characters.

Required variables:

- `CORS_ORIGIN`: exact comma-separated origins allowed to call the API; use HTTPS for staging/production and only localhost HTTP origins for local development. Include the Web Worker origin.
- `GAME_ADMIN_TELEGRAM_IDS`: comma-separated numeric Telegram administrator IDs.
- `ENVIRONMENT`: use `development` for initial staging validation.

Copy the shared **Transaction pooler** URI from Supabase Dashboard → Connect → Transaction pooler and store it as a Cloudflare Worker secret named `DATABASE_URL` (do not put it in Wrangler `vars`). Keep `DIRECT_URL` in the trusted migration environment only; use a direct or session-mode URL for Prisma migrations, never port `6543`. The runtime URL must include `?pgbouncer=true&sslmode=require` (merge these parameters with any existing query parameters). The Worker validates that non-development environments use the Supabase pooler hostname, port `6543`, and both parameters. The D1 binding named `DB` is not used by this PostgreSQL runtime.

For local development, copy `cloudflare/api/.dev.vars.example` to `cloudflare/api/.dev.vars` and replace placeholders with local development values. The real `.dev.vars` file is Git-ignored. The API Worker uses local port `8787`; the OpenNext Worker preview uses `8788`. For a fully functional local Mini App/API loop, run the API Worker and the ordinary Next.js dev server (port `3000`) with `NEXT_PUBLIC_API_URL=http://localhost:8787`. The production OpenNext build requires an HTTPS API origin, so use the deployed staging API Worker origin when validating the Cloudflare Mini App build.

Commands from repository root:

```bash
pnpm --dir cloudflare/api typecheck
pnpm --dir cloudflare/api test
pnpm --dir cloudflare/api check:worker
pnpm --dir cloudflare/api dev
```

The API Worker exposes the existing Fastify routes for Telegram auth, Bot auth, clubs, players, market, matches, groups, leagues, gifts, administration, and public records. `GET /health` does not require database credentials; `GET /ready` checks configuration and database connectivity.

### Background game processing

A SQLite-backed Durable Object named `MatchCoordinator` owns a persistent alarm and runs due match progression at the next scheduled action time (the current match engine uses five-second checkpoints). API write requests wake the coordinator so newly scheduled fixtures are discovered immediately. The coordinator re-arms itself for the earliest active runtime or future fixture, and stops when there is no pending work.

A one-minute Cron Trigger remains as a recovery/fallback path and processes promotion offers. If the Durable Object binding is unavailable, the Cron Trigger also runs the match processor, but that fallback has a slower cadence and is not the intended live configuration.

## D1 migration track

D1 schema conversion, migration files, and D1-native economy repositories remain in the repository as a future migration track. They are not attached to the live API Worker because only a subset of economy operations currently has D1 repositories and complete Fastify route parity is not implemented on D1.

Do not use Prisma's D1 adapter as a drop-in replacement for multi-record economy transactions. Do not switch live traffic to D1 until all domains have complete repositories and atomicity, idempotency, and concurrency tests.

## Telegram Bot boundary

The grammY Bot remains a separate long-polling process. This API Worker is not the Telegram Bot Worker.

- Keep the existing Bot in polling mode.
- Do not call Telegram `setWebhook`.
- Set the Bot's `FOOTBALL_API_URL` to the API Worker origin only after API readiness and route smoke tests pass.
- Keep `BOT_API_SECRET` server-side and out of the Mini App.

## Release boundary

This branch does not create Hyperdrive resources, configure account-specific secrets, create a production database, change DNS, deploy either Worker, change production data, or enable a Telegram webhook. No changes are made to `main`.
