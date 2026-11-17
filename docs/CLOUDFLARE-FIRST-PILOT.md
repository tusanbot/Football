# Cloudflare-first Telegram pilot

## Goal and safety boundary

The first invited-user pilot should run without a VPS. Telegram updates enter through a Cloudflare Worker webhook, while the Mini App and game API remain separate Workers.

No production Worker, primary Telegram bot webhook, BotFather setting, or live database was changed as part of this implementation. The staging database and Hyperdrive are now provisioned independently from production. The API, Bot, and Mini App staging configs point to the dedicated staging endpoints; staging deployment and test-Bot activation remain gated on test credentials and final connection validation.

## Implemented in the release branch

### Shared Bot application

- The grammY handlers were extracted from the Node process entry point into `apps/bot/src/bot-app.ts`.
- The shared factory receives explicit configuration and does not start polling, acquire the polling lease, register process signal handlers, or start recurring timers.
- `apps/bot/src/bot.ts` remains the optional Node.js long-polling adapter and retains the existing API readiness, Bot identity verification, webhook exclusivity check, and lease heartbeat.
- The Worker uses the same command/callback/group handler set, avoiding a second implementation of game behavior.

### Cloudflare webhook Worker

- Entry point: `apps/bot/src/worker.ts`
- Staging config: `apps/bot/wrangler.jsonc`
- Endpoint: `POST /telegram/webhook`
- Telegram's `X-Telegram-Bot-Api-Secret-Token` header is checked with a constant-time comparison.
- Request bodies are limited to 1 MiB; malformed JSON and invalid update envelopes are rejected.
- The Worker checks API readiness and verifies that its Telegram Bot token matches the Bot token configured in the Game API.
- CI/deploy scripts do not call Telegram `setWebhook`. Registering a webhook for the test bot is a separate staging activation step.

### Duplicate update protection

- A Durable Object named `BotUpdateGuard` atomically claims Telegram update IDs.
- Completed updates are treated as duplicates for seven days.
- Concurrent in-flight duplicates receive a retryable response; failed handlers release their claim so Telegram can retry.
- This is at-least-once processing with deduplication, not a guarantee of exactly-once external side effects. Game operations still need idempotency keys.

### Background jobs

- The four existing workers (group-message deletion, match checkpoint notifications, league notices, and admin group broadcasts) are exposed through a single bounded `runBackgroundJobs()` entry point.
- Cloudflare Cron invokes it every minute.
- The jobs continue using the existing PostgreSQL-backed claim/complete/fail API endpoints; the Worker does not depend on process-local timers.
- This is database-backed queue polling, not Cloudflare Queues. The existing database claim tokens and retry rules remain authoritative.
- Group replies target a 60-second deletion delay, but one-minute Cron polling means actual deletion can be later than 60 seconds.

### Pilot analytics

- Worker Analytics Engine dataset: `football_empire_pilot`.
- Bot updates record starts, command/callback usage, and private/group context.
- Mini App launch/session events are sent to `POST /miniapp/launch`. The Worker verifies Telegram Mini App `initData` with the Bot token, checks a 24-hour freshness window, and enforces the configured Mini App origin.
- Telegram user IDs are HMAC-pseudonymized using `ANALYTICS_HASH_SECRET`; raw IDs, message text, Bot tokens, and raw `initData` are not stored in Analytics Engine.
- Analytics writes are best-effort and cannot block gameplay.
- Cloudflare Worker observability provides request, CPU, duration, and exception metrics.
- Business-event analytics for every Mini App action (for example challenge creation/join and match participation) and retention cohort dashboards remain follow-up work. Bot command usage and Mini App sessions are available as the initial pilot signals.

### Mini App staging build

- Staging config: `apps/web/wrangler.staging.jsonc`
- Build command: `pnpm --dir apps/web build:worker:staging`
- It embeds the staging API URL and staging Bot Worker URL, not the production API URL.
- CI builds and archives production and staging Mini App bundles separately.

## Staging prerequisites that remain

The separate staging infrastructure is now provisioned, but deployment and live Telegram testing remain gated:

1. Supabase project `Football Empire Staging` (`uiwzbinjtglzqerymdwp`) is active in `eu-north-1`. All 42 SQL migrations are applied, all 61 Prisma models/tables exist, RLS is enabled on every public table, browser-facing roles have no table grants, all 9 foreign-key indexes and both alliance-FK repairs are present, and 15 curated special players are active. User, club, and group tables remain empty.
2. Hyperdrive `footballtest` (`3d3a95b34ee74952b551c0b28be61a00`) is dedicated to this staging project and now targets its direct PostgreSQL endpoint, `db.uiwzbinjtglzqerymdwp.supabase.co:5432`. It does not reference production.
3. The staging API config is `cloudflare/api/wrangler.staging.jsonc`, Worker name `football-empire-api-staging`. Its separate Durable Object namespace and staging CORS origin are configured in source.
4. Bot and Mini App staging configs point to `https://football-empire-api-staging.mshmahyar9.workers.dev`; Mini App origin is `https://football-empire-web-staging.mshmahyar9.workers.dev`; Bot Worker origin is `https://football-empire-bot-staging.mshmahyar9.workers.dev`.
5. Supabase's migration ledger has all 42 SQL migrations. Prisma's separate `_prisma_migrations` ledger still needs to be registered because the API readiness gate checks it. The guarded workflow `.github/workflows/register-staging-migrations.yml` performs `prisma migrate resolve --applied` for the already-applied SQL migrations; it does not rerun DDL. Add the repository secret `STAGING_DIRECT_URL` pointing to the direct staging connection string (host must be `db.uiwzbinjtglzqerymdwp.supabase.co`), then manually dispatch this workflow on `feat/telegram-production-readiness` with `REGISTER_STAGING_MIGRATIONS`.
6. For staging deployment, add repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STAGING_TELEGRAM_BOT_TOKEN`, and `STAGING_GAME_ADMIN_TELEGRAM_IDS`. The deploy workflow generates unique staging-only API, webhook, and analytics secrets at runtime and stores them as Cloudflare Worker secrets.
7. Create a separate Telegram test Bot with BotFather. Never use the primary Bot token. The staging deployment workflow `.github/workflows/deploy-staging.yml` is manually gated by `DEPLOY_STAGING`; it deploys only the three staging Workers, verifies API readiness and web/Bot health, and deliberately does not call Telegram `setWebhook`.
8. Webhook registration is a separate activation step and must only happen after the user explicitly approves starting the test Bot. No Bot webhook has been registered and no Bot has been started.

## Validation status

- Unit tests cover webhook route security, update claim/duplicate/release behavior, Telegram Mini App signature verification, freshness checks, and pseudonymous analytics events.
- CI includes Bot typechecking/tests, Wrangler dry-runs for the Bot and both API configs, and separate production/staging Mini App builds.
- The previous full CI run succeeded. The staging API config, real staging API URLs, migration-registration workflow, and guarded staging deployment workflow have since been added; the latest CI run must complete successfully before deployment.
- No staging Worker has been deployed, no Telegram webhook has been registered, and no Telegram end-to-end test has been completed.

## Pilot acceptance criteria

The pilot is ready for invited users only when:

1. The test Bot receives webhook updates on Cloudflare without a VPS.
2. Private commands, Mini App launch, group commands, challenges, and match decisions pass end-to-end tests.
3. Background notifications and message deletion survive Worker restarts and retry transient failures.
4. Analytics reports starts, active users, command usage, Mini App sessions, API errors, and platform resource consumption without storing message content or raw Telegram IDs.
5. API readiness and Mini App smoke tests pass against the staging database.
6. A rollback plan exists and preserves game data.

After measuring real usage, resource consumption, and retention, decide whether to remain Cloudflare-only or add one or more Node.js workers/servers. Future multi-bot support still requires a bot registry, per-bot secrets, and bot-specific routing; the current staging Worker is intentionally single-bot.
