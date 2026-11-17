# Cloudflare-first Telegram pilot

## Goal and safety boundary

The first invited-user pilot should run without a VPS. Telegram updates enter through a Cloudflare Worker webhook, while the Mini App and game API remain separate Workers.

No production Worker, primary Telegram bot webhook, BotFather setting, or production database was changed. The isolated staging database and Hyperdrive are provisioned independently. The API, Bot, and Mini App staging Workers are deployed and passed their deployment health checks. The test Bot webhook is now registered and verified against the staging Worker; its Cron trigger remains disabled.

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
- The Worker exposes a scheduled handler for the four queues. The staging Wrangler config intentionally has no Cron trigger yet, so background jobs remain dormant until the test Bot is explicitly activated.
- The jobs continue using the existing PostgreSQL-backed claim/complete/fail API endpoints; the Worker does not depend on process-local timers.
- This is database-backed queue polling, not Cloudflare Queues. The existing database claim tokens and retry rules remain authoritative.
- Once the staging Cron trigger is explicitly enabled, one-minute polling means group-message deletion can occur later than the configured 60-second target.

### Pilot analytics

- Analytics Engine is not required or enabled for this pilot. The staging PostgreSQL table and Prisma migration ledger are applied; events are persisted through the private API endpoint `POST /internal/pilot/events`.
- Bot updates record successful starts, command/callback usage, and private/group context. Mini App launch/session events are recorded after Telegram `initData` signature and freshness validation.
- Telegram user IDs are HMAC-pseudonymized with a staging-only `ANALYTICS_HASH_SECRET`. The event table stores only the truncated 128-bit HMAC key, event/action category, chat type, source, and timestamp. Raw Telegram IDs, message text, raw callback payloads, Bot tokens, and raw `initData` are never persisted.
- The API accepts analytics writes only with the private Bot/API shared secret, validates a strict event allowlist and payload bounds, and writes through Hyperdrive. RLS is enabled and browser-role grants are revoked on the analytics table.
- Analytics writes are best-effort and do not block gameplay. Bot events are recorded only after successful handler completion. Cloudflare Worker observability separately provides request, CPU, duration, and exception metrics.
- Read-only SQL reports for starts, DAU, command usage, Mini App sessions, private/group activity, and first-week retention are in [docs/PILOT-ANALYTICS-QUERIES.md](./PILOT-ANALYTICS-QUERIES.md). Business-event analytics (challenge creation/join, match participation) and an in-app admin dashboard remain follow-up work.

### Mini App staging build

- Staging config: `apps/web/wrangler.staging.jsonc`
- Build command: `pnpm --dir apps/web build:worker:staging`
- It embeds the staging API URL and staging Bot Worker URL, not the production API URL.
- CI builds and archives production and staging Mini App bundles separately.

## Staging deployment status and remaining launch gates

The isolated staging environment is deployed. The remaining work is live Telegram acceptance testing, not infrastructure provisioning:

1. Supabase project `Football Empire Staging` (`uiwzbinjtglzqerymdwp`) is active in `eu-north-1`. The 42 original migrations plus `20261117140000_pilot_analytics_events` are applied. Prisma's `public._prisma_migrations` ledger contains 43/43 finished records. The new analytics table has RLS enabled, no browser-role SELECT grants, and INSERT permission for the dedicated `football_runtime` role. No pilot events exist yet because the Bot has not been activated.
2. Hyperdrive `footballtest` (`3d3a95b34ee74952b551c0b28be61a00`) targets only the staging PostgreSQL endpoint `db.uiwzbinjtglzqerymdwp.supabase.co:5432`; it does not reference production.
3. API Worker `football-empire-api-staging` is deployed. Its deployment workflow verified `/ready` successfully against the staging database.
4. Mini App Worker `football-empire-web-staging` and Bot Worker `football-empire-bot-staging` are deployed. The deployment workflow verified the Mini App HTTP smoke test and Bot `/health` successfully. All three Workers have their staging-only database, Durable Object, and application bindings configured.
5. The staging deployment workflow generates unique API, webhook, and analytics HMAC secrets at runtime and stores them as Worker secrets. Secret values are not exposed in source or logs.
6. The staging deployment completed successfully in [workflow run 44045746154](https://github.com/tusanbot/Football/actions/runs/44045746154). CI for the same analytics implementation passed in [workflow run 44045194345](https://github.com/tusanbot/Football/actions/runs/44045194345).
7. The staging Bot identity was verified with Telegram `getMe`; its existing webhook was confirmed empty or already pointing to the same staging endpoint before registration. Telegram `setWebhook` then succeeded and `getWebhookInfo` confirmed the exact staging URL and required update types. The webhook secret was freshly generated and stored only in the staging Worker. No production Worker, secret, webhook, or database was changed. The staging Worker still has no Cron trigger, so scheduled background jobs remain dormant.

## Staging Bot activation

The staging-only activation workflow is [run 44050136938](https://github.com/tusanbot/Football/actions/runs/44050136938). It verified the staging API and Bot Worker health, checked the staging Bot identity with Telegram, refused to overwrite an unexpected pre-existing webhook, generated and stored a new staging webhook secret, registered the staging URL, and verified the resulting Telegram webhook configuration. Pending Telegram updates were preserved. The production Bot was not addressed.

Webhook endpoint: `https://football-empire-bot-staging.mshmahyar9.workers.dev/telegram/webhook`

The staging Worker still has no Cron trigger. Bot commands and Mini App launch are now able to receive updates; scheduled background jobs remain disabled until separately tested and enabled.

## Pilot acceptance criteria

The pilot is ready for invited users only when:

1. The test Bot receives webhook updates on Cloudflare without a VPS.
2. Private commands, Mini App launch, group commands, challenges, and match decisions pass end-to-end tests.
3. Background notifications and message deletion survive Worker restarts and retry transient failures.
4. Analytics reports starts, active users, command usage, Mini App sessions, API errors, and platform resource consumption without storing message content or raw Telegram IDs.
5. API readiness and Mini App smoke tests pass against the staging database.
6. A rollback plan exists and preserves game data.

After measuring real usage, resource consumption, and retention, decide whether to remain Cloudflare-only or add one or more Node.js workers/servers. Future multi-bot support still requires a bot registry, per-bot secrets, and bot-specific routing; the current staging Worker is intentionally single-bot.## Validation status

- CI passed Prisma schema validation and migration deployment, Bot tests, Cloudflare API typechecking and runtime tests (including authenticated analytics persistence and invalid-payload rejection), Worker dry-runs, and production/staging Mini App builds.
- Staging deployment run [44045746154](https://github.com/tusanbot/Football/actions/runs/44045746154) completed successfully: API readiness, Mini App smoke test, and Bot health checks all passed.
- The analytics table is ready but currently contains zero events. Real usage metrics will begin only after the test Bot is explicitly activated and Mini App sessions are launched by testers.
- The staging Telegram webhook is registered and verified. No user-originated Telegram update has yet been confirmed end-to-end; the first `/start` and Mini App launch will validate actual traffic and populate analytics.

## Pilot acceptance criteria

The pilot is ready for invited users only when:

1. The test Bot receives webhook updates on Cloudflare without a VPS.
2. Private commands, Mini App launch, group commands, challenges, and match decisions pass end-to-end tests.
3. Background notifications and message deletion survive Worker restarts and retry transient failures.
4. Analytics reports starts, active users, command usage, Mini App sessions, API errors, and platform resource consumption without storing message content or raw Telegram IDs.
5. API readiness and Mini App smoke tests pass against the staging database.
6. A rollback plan exists and preserves game data.

After measuring real usage, resource consumption, and retention, decide whether to remain Cloudflare-only or add one or more Node.js workers/servers. Future multi-bot support still requires a bot registry, per-bot secrets, and bot-specific routing; the current staging Worker is intentionally single-bot.
