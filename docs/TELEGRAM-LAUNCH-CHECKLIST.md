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

The API readiness endpoint is `/ready`; health-only endpoint is `/health`. The readiness gate checks database connectivity, required schema migrations, RLS on every public table, and the absence of direct grants to `anon` and `authenticated`.

### Mini App Worker: `football`

Build-time variable:

- `NEXT_PUBLIC_API_URL=https://football-empire-api.mshmahyar9.workers.dev`

This value is public and is compiled into the Next.js build. Do not put bot tokens, database credentials, or `BOT_API_SECRET` in `NEXT_PUBLIC_*` variables.

The public Mini App URL must be HTTPS. Set the Bot runtime's `TELEGRAM_WEB_APP_URL` to this exact origin. The Mini App must be built with `pnpm --dir apps/web build:worker` and deployed as the compiled OpenNext Worker with its generated assets; a plain Worker returning `Hello world` is not a Mini App deployment.

### Telegram Bot process

Required environment variables:

- `NODE_ENV=production`
- `TELEGRAM_BOT_TOKEN` — same bot token used by the API Worker
- `BOT_API_SECRET` — same server-to-server secret as the API Worker
- `FOOTBALL_API_URL=https://football-empire-api.mshmahyar9.workers.dev`
- `TELEGRAM_WEB_APP_URL=https://football.mshmahyar9.workers.dev`

Build and run:

```bash
pnpm install --frozen-lockfile
pnpm --filter @football/bot build
node apps/bot/dist/bot.js
```

Run this as a supervised, persistent Node.js process. Do not run more than one Bot process against the same database. The PostgreSQL polling lease prevents concurrent polling; if the process loses its lease or cannot renew it, it stops.

The Bot's `/start` and `/menu` flows provide a Web App launch button, and `/miniapp` sends the launch button directly. These buttons are private-chat only. The `/help` command documents the entry point.

## Database release gate

The current PostgreSQL schema has 62 public tables. The security migration enables RLS on every public table, revokes direct table/sequence/function access from browser-facing Supabase roles, and locks down default privileges for future Prisma migrations. The API uses a server-side database connection; do not grant direct browser access to game tables.

The foreign-key performance migration adds indexes for the nine previously unindexed public foreign keys. The migrations are safe to re-run at the SQL level (`CREATE INDEX IF NOT EXISTS` and RLS enablement are idempotent), but Prisma must still run `pnpm db:migrate:deploy` so its migration history records them.

The live development database has also been seeded with the 15 active curated special-player records. User, club, and player tables remain empty; no test accounts or game progress have been created.

After the release branch is merged into the intended deployment branch and migrations have been deployed, verify:

1. `/ready` returns HTTP 200 and `status: ready`.
2. All public tables have RLS enabled.
3. `anon` and `authenticated` have no public table/sequence/function access.
4. The 9 foreign-key indexes exist.
5. `pnpm --filter @football/api db:seed:special` has been run and the special-player catalog contains the expected 15 records.

Do not drop unused indexes merely because the advisor currently reports them: this database has no game workload yet, so index usage statistics are not representative.

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
- The currently deployed API Worker still has `ENVIRONMENT=development`; switch it to `production` only during the approved production release. The Wrangler config now sets `keep_vars: true` so dashboard variables are not silently overwritten before they are brought under source control.
- The `football` Worker currently contains a placeholder `Hello world` handler and reports no static assets. It is **not** the compiled Mini App.
- No Cloudflare Workers Builds configuration was found for the existing `football` or `football-empire-api` script names.
- The Bot long-polling process has not been started, and no separate persistent Node.js Bot runtime has been selected/configured in the deployment environment.
- A real end-to-end Telegram session has therefore not yet been verified.

These are deployment/operations gates, not reasons to bypass the checks. Do not claim the game is live until the tests above pass.

## Release safety

The release branch and pull request can be reviewed and tested independently. Do not merge to the production branch, deploy either Worker, configure a webhook, or start Bot polling until the user explicitly approves that launch step.
