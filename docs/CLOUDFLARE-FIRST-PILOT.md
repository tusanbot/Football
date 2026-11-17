# Cloudflare-first Telegram pilot

## Goal and safety boundary

The first invited-user pilot should run without a VPS. Telegram updates enter through a Cloudflare Worker webhook, while the Mini App and game API remain separate Workers.

No production Worker, primary Telegram bot webhook, BotFather setting, or live database was changed as part of this implementation. The staging configs deliberately contain non-routable API placeholders until a separate staging database and API are provisioned.

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

A working staging test cannot be completed until all of these are supplied/provisioned:

1. A separate staging Postgres database. The current Supabase project has no development branches. Creating a Supabase development branch was quoted at **$0.01344/hour** (about **$9.68 for 30 days** if continuously running). No branch was created because the recurring charge needs explicit approval.
2. A separate staging Hyperdrive binding pointing only to that staging database.
3. A staging Game API Worker with `ENVIRONMENT=staging`, staging CORS origin, and staging secrets. The existing API Worker configuration is not silently repointed.
4. A separate Telegram test Bot token and matching webhook secret.
5. The staging Bot Worker's secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `BOT_API_SECRET`, and `ANALYTICS_HASH_SECRET` (at least 32 characters).
6. The staging Mini App and Bot Worker deployed, then the test Bot webhook registered with allowed updates `message, edited_message, callback_query, chat_member, my_chat_member`.

The staging API URL in `apps/bot/wrangler.jsonc` and `apps/web/wrangler.staging.jsonc` remains `.example.invalid` intentionally. Do not deploy the staging Bot Worker against the current production API/database or the primary Telegram Bot.

## Validation status

- Unit tests cover webhook route security, update claim/duplicate/release behavior, Telegram Mini App signature verification, freshness checks, and pseudonymous analytics events.
- CI includes Bot typechecking/tests, a Wrangler Bot Worker dry-run, and separate production/staging Mini App builds.
- The latest observed CI run is pending; the earlier run failed at strict TypeScript checks in the initial adapter draft. Those reported typing issues were corrected, but the new run must complete successfully before calling the code verified.
- No staging deployment or Telegram end-to-end test has been completed yet.

## Pilot acceptance criteria

The pilot is ready for invited users only when:

1. The test Bot receives webhook updates on Cloudflare without a VPS.
2. Private commands, Mini App launch, group commands, challenges, and match decisions pass end-to-end tests.
3. Background notifications and message deletion survive Worker restarts and retry transient failures.
4. Analytics reports starts, active users, command usage, Mini App sessions, API errors, and platform resource consumption without storing message content or raw Telegram IDs.
5. API readiness and Mini App smoke tests pass against the staging database.
6. A rollback plan exists and preserves game data.

After measuring real usage, resource consumption, and retention, decide whether to remain Cloudflare-only or add one or more Node.js workers/servers. Future multi-bot support still requires a bot registry, per-bot secrets, and bot-specific routing; the current staging Worker is intentionally single-bot.
