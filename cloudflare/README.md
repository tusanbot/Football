# Football Empire — Cloudflare Workers setup

This directory documents the non-production Cloudflare runtime setup. The repository currently has two Worker applications:

1. **Web / Telegram Mini App** — the existing Next.js 15 app, adapted with OpenNext for Cloudflare Workers.
2. **Game API** — a separate Worker with a D1 binding and migration scaffold.

The Bot is still the existing grammY long-polling Node.js process. It is **not** a Cloudflare webhook Worker yet. Do not configure a Telegram webhook or point Telegram updates at either Worker.

## Cloudflare dashboard: connect the two Workers

Use the same repository and the `feat/cloudflare-worker-runtime` branch for the first validation pass. Configure each Worker independently:

| Setting | Web / Mini App | Game API |
| --- | --- | --- |
| Root directory | `apps/web` | `cloudflare/api` |
| Config file | `wrangler.jsonc` | `wrangler.jsonc` |
| Worker name | `football-empire-web-dev` | `football-empire-api-dev` |
| Local preview | `pnpm preview:worker` | `pnpm dev` |
| Build command | `pnpm dlx @opennextjs/cloudflare@1.20.17 build` | `pnpm typecheck` |
| Deploy command | **Leave unset until explicitly approved** | **Leave unset until API migration gates pass** |

Do not use `npx wrangler deploy` from the repository root. Each Worker has its own root directory and Wrangler configuration. When a deploy is eventually approved, invoke the adapter/Wrangler from that Worker root with its own config.

## 1. Web / Telegram Mini App Worker

The Web Worker uses the maintained OpenNext Cloudflare adapter for the existing Next.js 15 application. Its configuration is in `apps/web/wrangler.jsonc` and points to the adapter output at `.open-next/worker.js`.

Required runtime settings:

- `nodejs_compat` is enabled.
- Static assets are served through the `ASSETS` binding.
- Source maps and Worker observability are enabled.
- No production route, custom domain, or secret is embedded in the repository.
- `NEXT_PUBLIC_API_URL` is a **build-time public value**. Set it in the Web Worker build environment to the HTTPS origin of the intended API. Never put `BOT_API_SECRET` or the Telegram Bot token in a `NEXT_PUBLIC_*` variable.

From the repository root, install the workspace dependencies first, then preview the production Worker build:

```bash
pnpm install --frozen-lockfile
pnpm --dir apps/web preview:worker
```

This runs the OpenNext build and starts its local Workers preview. It does not deploy anything. The ordinary `pnpm --dir apps/web dev` command remains the Node.js Next.js development server and is not a substitute for Workers-runtime preview.

The Worker does not yet have an approved production API origin. Do not publish the Mini App against the Cloudflare API scaffold: its game routes intentionally return HTTP 503.

## 2. Game API Worker

The API Worker configuration is in `cloudflare/api/wrangler.jsonc`. It defines:

- Entry point: `src/index.ts`
- D1 binding: `DB`
- Development database name: `football-empire-dev`
- Migrations directory: `migrations`
- Local-only placeholder D1 ID: `00000000-0000-0000-0000-000000000001`

The placeholder is only for Wrangler's local D1 state. It is **not** the ID of a real Cloudflare database. Before any remote D1 operation, create/select the intended development D1 database and replace this value with its actual ID. Do not apply the generated game-schema draft remotely.

From the repository root:

```bash
pnpm --dir cloudflare/api typecheck
pnpm --dir cloudflare/api test
pnpm --dir cloudflare/api dev
```

Optional local D1 migration command (only changes local Wrangler state):

```bash
pnpm --dir cloudflare/api db:migrate:local
```

The API Worker is still a migration scaffold, not a game API release:

- `GET /health` is available.
- `GET /ready` intentionally returns HTTP 503 until all migration gates pass.
- All `/v1/*` game routes intentionally return HTTP 503.
- The generated D1 schema and the small set of D1-native economy repositories do not constitute full API route parity.
- PostgreSQL remains the authoritative development database.

Do not deploy this Worker or configure the Web Worker to use it for game traffic yet.

## 3. API migration gates before deployment

The following must be completed and verified before the API Worker can be considered deployable:

1. Review and test the generated D1 schema against every PostgreSQL model, migration, constraint and index.
2. Complete D1-native repositories for every game domain; do not use Prisma's D1 adapter for the existing transactional economy.
3. Prove atomicity, idempotency and concurrency behavior for wallet/ledger, transfers, rewards, competitions and all other multi-record writes.
4. Port API authentication, authorization, rate limits and **all** existing Fastify routes with Bot/Mini App parity.
5. Add integration tests against local D1 and run realistic concurrency/load and backup/restore tests.
6. Change `/ready` only after those gates are satisfied; keep unknown and unported game routes fail-closed.

## 4. Bot and Telegram webhook status

The current Bot remains `apps/bot`, runs grammY long polling, checks API readiness, and owns a PostgreSQL polling lease. A Worker-safe Bot factory, durable Telegram update deduplication, retry-safe Queue consumers, and command parity have not yet been completed.

Therefore:

- Keep the existing Bot in polling mode.
- Do not call Telegram `setWebhook`.
- Do not set a webhook URL in BotFather.
- Do not add `TELEGRAM_BOT_TOKEN` to the Web or API Worker configuration.
- Keep `BOT_API_SECRET` server-side and out of the Mini App.

## 5. Current release boundary

This setup provides reproducible per-Worker configuration and local preview commands. It does **not** mean the Cloudflare migration is complete or that either Worker is approved for production deployment. No production database, DNS route, custom domain, webhook, or deployment is changed by these repository files.
