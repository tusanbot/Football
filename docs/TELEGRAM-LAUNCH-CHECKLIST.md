# Football Empire — Telegram launch readiness

This document is the operational release checklist for the Telegram Bot, Mini App, API Worker, and PostgreSQL database. A successful CI build is not proof of a live Telegram launch.

## Runtime topology

- **Mini App:** Cloudflare Worker `football`, built from `apps/web` with OpenNext. It must serve the compiled Next.js Worker and static assets.
- **Game API:** Cloudflare Worker `football-empire-api`, built from `cloudflare/api`, backed by Supabase PostgreSQL through Hyperdrive.
- **Telegram Bot:** separate Node.js 22+ process running `apps/bot` in long-polling mode. It must run continuously; exactly one process may own the database-backed polling lease.
- **Database:** Supabase PostgreSQL is authoritative. The Bot and Mini App call the same API; neither client connects directly to PostgreSQL.

The Bot does not use a Telegram webhook. It checks that no webhook is configured before starting long polling and does not silently delete or replace an existing webhook.

## Required runtime configuration

### API Worker: `football-empire-api`

- Hyperdrive binding: `HYPERDRIVE`
- Secret: `TELEGRAM_BOT_TOKEN`
- Secret: `BOT_API_SECRET` (at least 32 random characters)
- Variable: `CORS_ORIGIN` (exact HTTPS origin of the Mini App Worker)
- Variable: `GAME_ADMIN_TELEGRAM_IDS` (comma-separated numeric Telegram IDs)
- Variable: `ENVIRONMENT` (`development` during staging; production policy otherwise)

The API production config is `cloudflare/api/wrangler.production.jsonc`; CI validates it with a Wrangler dry run. The API readiness endpoint is `/ready`; health-only endpoint is `/health`. The readiness gate checks database connectivity, required schema migrations, at least 15 active special-player catalog records, a server-side database role that bypasses RLS, RLS on every public table, and the absence of direct table/sequence/function grants to `anon` and `authenticated`.

### Mini App Worker: `football`

Build-time variable:

- `NEXT_PUBLIC_API_URL=https://football-empire-api.mshmahyar9.workers.dev`

This value is public and is compiled into the Next.js build. Do not put bot tokens, database credentials, or `BOT_API_SECRET` in `NEXT_PUBLIC_*` variables.

The public Mini App URL must be HTTPS. Set the Bot runtime's `TELEGRAM_WEB_APP_URL` to this exact origin. The Mini App production build is `pnpm --dir apps/web build:worker:production` (using `apps/web/wrangler.production.jsonc`) and must be deployed as the compiled OpenNext Worker with its generated assets; a plain Worker returning `Hello world` is not a Mini App deployment.

### Telegram Bot process

Required environment variables:

- `NODE_ENV=production`
- `TELEGRAM_BOT_TOKEN` — same bot token used by the API Worker
- `BOT_API_SECRET` — same server-to-server secret as the API Worker
- `FOOTBALL_API_URL=https://football-empire-api.mshmahyar9.workers.dev`
- `TELEGRAM_WEB_APP_URL=https://football.mshmahyar9.workers.dev`

Build and run directly:

```bash
pnpm install --frozen-lockfile
pnpm --filter @football/bot build
node apps/bot/dist/bot.js
```

A host-neutral Docker runtime is also included. Copy `.env.bot.example` to `.env.bot`, fill the four values using the API Worker credentials and the two HTTPS URLs, then on the selected Node/Docker host run:

```bash
docker compose -f docker-compose.bot.yml up -d --build
docker compose -f docker-compose.bot.yml logs -f telegram-bot
```

The compose service uses a persistent restart policy and a non-root container. It is intentionally not started by CI or by this preparation workflow.

Run this as a supervised, persistent Node.js process. Do not run more than one Bot process against the same database. The PostgreSQL polling lease prevents concurrent polling; if the process loses its lease or cannot renew it, it stops.

The Bot's `/start`, `/menu`, and `/miniapp` flows set a per-chat Telegram Web App menu button and provide an inline launch button. These buttons are private-chat only. A profile-wide Main Mini App button is a separate optional BotFather configuration. The `/help` command documents the entry point.

## Database release gate

The current PostgreSQL schema has 62 public tables. The security migration enables RLS on every public table, revokes direct table/sequence/function access from browser-facing Supabase roles, and locks down default privileges for future Prisma migrations. The API uses a server-side database connection; do not grant direct browser access to game tables.
There are intentionally no RLS policies for `anon` or `authenticated`: direct browser access is not part of this architecture, and an enabled RLS table with no matching policy denies those roles. The Supabase Security Advisor's `rls_enabled_no_policy` INFO finding for these 62 tables is therefore expected; do not add broad `USING (true)` policies to silence it. The Performance Advisor's unused-index INFO findings are also expected before real game traffic; do not drop indexes based on zero usage yet.

The foreign-key performance migration adds indexes for the nine previously unindexed public foreign keys. A separate repair migration restores the two missing alliance foreign-key constraints without editing the already-applied historical migration. The three pending release migrations are safe to re-run at the SQL level (RLS/revokes, `CREATE INDEX IF NOT EXISTS`, and conditional FK creation are idempotent), but Prisma must still run `pnpm db:migrate:deploy` so its migration history records them.

The live development database has also been seeded with the 15 active curated special-player records. User, club, and player tables remain empty; no test accounts or game progress have been created.

After the release branch is merged into the intended deployment branch and migrations have been deployed, verify:

1. `/ready` returns HTTP 200 and `status: ready`.
2. All public tables have RLS enabled.
3. `anon` and `authenticated` have no public table/sequence/function access.
4. The 9 foreign-key indexes exist.
5. `pnpm --filter @football/api db:seed:special` has been run and the special-player catalog contains the expected 15 records.

Do not drop unused indexes merely because the advisor currently reports them: this database has no game workload yet, so index usage statistics are not representative.

## Production deployment workflow

The repository includes a guarded GitHub Actions workflow at `.github/workflows/deploy-production.yml`. It can only deploy from the `main` branch and requires the explicit `DEPLOY_PRODUCTION` dispatch choice. Before using it, add these GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with Workers Scripts Write permission for this account.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account identifier.
- `DATABASE_URL`: PostgreSQL connection string used by the Prisma runtime and seed.
- `DIRECT_URL`: direct PostgreSQL connection string for Prisma migrations.

After the complete release branch has been reviewed and merged into `main`, open GitHub Actions → **Deploy Football Empire to Telegram production**, select branch `main`, choose `DEPLOY_PRODUCTION`, and run the workflow. It installs dependencies, applies pending Prisma migrations, upserts the 15-player catalog, deploys the API Worker with `ENVIRONMENT=production`, requires `/ready` to report ready, builds and deploys the compiled Mini App Worker, and verifies that the Mini App origin serves the Next.js app. If a required secret is missing or readiness fails, the workflow stops before proceeding.

This workflow does not start the Telegram Bot process, configure a webhook, or change BotFather settings.

## Live Telegram acceptance tests

Run these only after the API and Mini App are deployed to the intended staging origin and the Bot runtime has been explicitly approved for start.

### Private chat

- `/start` provisions or loads the same Telegram account and primary club.
- The reply keyboard exposes the Bot's core commands.
- The Web App launch button and `/miniapp` open the Mini App inside Telegram.
- Mini App `initData` is verified by the API; invalid or stale init data is rejected.
- Account, wallet, squad, market, store, match, league, and administration operations use the same API/domain rules from both clients.
- `/menu` returns the private Bot menu.

### Group chat

- Add the Bot to a test supergroup and grant the required administrator permissions.
- Register the group and join a club using the documented group commands.
- Verify membership updates, member threshold, activity points, treasury, rewards, challenges, local leagues, and alliance invitations/competitions.
- Verify that manager-only operations reject ordinary members and that the Bot checks live Telegram membership/admin status.
- Verify group-message retention/deletion and durable notification queues.

### Match and economy integrity

- Create a friendly challenge and accept it from another Telegram account.
- Create and join a league/cup and run a match.
- Submit tactical checkpoint decisions and substitutions from both clients.
- Verify that wallet/ledger movements, player ownership, match results, and rewards are atomic, idempotent, and recorded once.
- Verify scheduled match progression and promotion processing.

## Current observed release blockers

The following were verified during the current readiness audit:

- The API Worker exists and has a Hyperdrive binding plus the required API secret names configured. Its latest recorded deployment is older than the current source branch; this branch's new readiness gate has not been deployed.
- The currently deployed API Worker still has `ENVIRONMENT=development`. The guarded production release workflow deploys the production Wrangler config, which explicitly sets `ENVIRONMENT=production` and the exact Mini App `CORS_ORIGIN`; `keep_vars: true` preserves the other dashboard-managed admin/reviewer IDs and secrets.
- The `football` Worker currently contains a placeholder `Hello world` handler and reports no static assets. It is **not** the compiled Mini App. A production-targeted OpenNext Wrangler config now exists in source, but it has not been deployed.
- Cloudflare Workers Builds is connected to `tusanbot/Football` with an automatic build trigger for `feat/telegram-production-readiness`. Its current build command is `pnpm --filter @football/web build:worker`; its deploy command is explicitly a no-op, and previews are disabled. The latest completed Cloudflare build succeeded. GitHub CI separately builds the production-targeted Mini App with `build:worker:production`; the guarded release workflow performs the actual production deploy.
- The Bot long-polling process has not been started, and no separate persistent Node.js Bot runtime has been selected/configured in the deployment environment.
- A real end-to-end Telegram session has therefore not yet been verified.

These are deployment/operations gates, not reasons to bypass the checks. Do not claim the game is live until the tests above pass.

## Release safety

The release branch and pull request can be reviewed and tested independently. Do not merge to the production branch, deploy either Worker, configure a webhook, or start Bot polling until the user explicitly approves that launch step.
