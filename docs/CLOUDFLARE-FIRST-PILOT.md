# Cloudflare-first Telegram pilot

## Decision

The first public pilot must not require a VPS. Telegram updates will be received through a Cloudflare Worker webhook. The existing Node.js long-polling process is not deployable as-is to Workers and must not be imported into a Worker as a shortcut.

The current Bot entry point (`apps/bot/src/bot.ts`) combines four concerns in one module:

1. grammY command, callback-query, and membership handlers;
2. Telegram API calls and shared API client logic;
3. process startup, long-polling, and webhook exclusivity checks;
4. recurring background workers for group-message deletion, match notifications, league notices, group broadcasts, and a PostgreSQL polling lease.

A webhook adapter that only calls `bot.handleUpdate()` would cover incoming updates but would silently omit the recurring workers. Conversely, keeping the current long-polling entry point requires a persistent Node.js host and defeats the no-server pilot goal.

## Target topology

- **Telegram ingress Worker:** validates Telegram's `X-Telegram-Bot-Api-Secret-Token`, bounds request size, parses the update, and dispatches it to the bot application.
- **Bot application package:** exports a side-effect-free bot factory and update handler. It must not start polling, read process-level secrets at module import time, create process timers, or acquire a single-instance polling lease.
- **Game API Worker:** remains the authoritative application/API layer and uses the existing Hyperdrive + PostgreSQL connection.
- **Mini App Worker:** remains the compiled OpenNext application; it must not be replaced by a placeholder Worker.
- **Durable background work:** scheduled delivery and deletion work moves out of Node.js `setInterval` loops. Use Cloudflare Queues for retryable delivery jobs and Cron Triggers for periodic claiming/reconciliation; retain database claim tokens/idempotency so duplicate queue deliveries are safe.
- **Durable Objects:** keep match coordination where per-match serialization/state is required. Do not use a single global object as the general-purpose queue for all bot updates.

The ingress Worker and Mini App remain separate deployable services. The webhook path should include a non-secret bot identifier; the Telegram secret token is validated from the request header and is never placed in a URL or logged.

## Required implementation sequence

### 1. Extract a portable bot application

Refactor `apps/bot/src/bot.ts` into:
- a factory that accepts explicit configuration and returns the grammY bot instance;
- registration modules for private commands, group commands, callbacks, and membership updates;
- a Node-only long-polling entry point that retains the existing lease behavior for local development/optional future server hosting.

The application factory must not call `bot.start()`, `getWebhookInfo()`, acquire a polling lease, register process signal handlers, or start timers. Keep the command behavior shared between webhook and long-polling adapters to prevent feature drift.

### 2. Add the Cloudflare webhook adapter

Create a dedicated Worker entry point with:
- POST-only webhook route;
- constant-time comparison of the Telegram webhook secret header;
- bounded JSON body and malformed-update handling;
- grammY update dispatch with an explicit `allowed_updates` list matching the current bot;
- no logging of tokens, secret headers, raw update payloads, or unnecessary Telegram identifiers;
- safe handling of Telegram retries and duplicate update delivery.

Do not register or replace the live Telegram webhook from CI or deployment automation. Webhook registration is a separate, explicitly approved launch action.

### 3. Move recurring work to durable execution

Inventory each current interval worker and migrate it independently:
- group-message deletion;
- match checkpoint notifications;
- league notices;
- admin group broadcasts;
- any other queue consumer discovered during extraction.

Use bounded batches, claim/ack/fail semantics, exponential retry with a maximum attempt/dead-letter policy, and idempotent completion. Cron should enqueue or claim bounded work; it should not run an unbounded batch inside one invocation. Remove the Node polling lease only from webhook mode; preserve it for the optional long-polling adapter.

### 4. Add privacy-minimal pilot analytics

Track server-side counters/events with a defined retention policy:
- bot updates received, accepted, rejected, and failed;
- unique users starting the bot and daily/monthly active users;
- command/callback usage by command name, not message text;
- Mini App launches/sessions and API errors;
- group registrations, challenge creation/join, and match participation;
- Worker request count, CPU time, duration, exceptions, queue age/retries, Durable Object usage, and database latency.

Do not store raw message text or full Telegram update bodies for analytics. Prefer daily aggregates and pseudonymous user keys. Keep operational logs separate from product analytics. Analytics failure must never block gameplay requests.

### 5. Validate before any live activation

CI must cover:
- bot application factory tests without network access;
- webhook secret rejection and body-size limits;
- duplicate update handling and Telegram retry behavior;
- private and group command parity;
- callback queries and chat-member events;
- queue retry/ack/dead-letter behavior;
- scheduled worker tests and typechecks;
- Worker dry-runs for ingress, API, and Mini App.

A staging deployment and test Telegram bot should be used before the primary bot is touched. Production deployment, webhook registration, BotFather changes, database migrations against the live project, and starting any bot process remain explicit approval gates.

## Current verified blockers

- The current bot is a Node.js long-polling process; the entry point ends by calling `bot.start()`.
- The bot entry point creates recurring Node timers for four background queues and a polling-lease heartbeat.
- The API Worker already has a Hyperdrive binding and Durable Object match coordinator, but that does not provide Telegram webhook ingress.
- The Mini App Worker has a separate OpenNext production build/deploy path. A successful build is not evidence that the compiled Mini App is live.
- The API production readiness gate checks database migrations/security/catalog; the live API environment must be production before the pilot can be accepted.
- No real Telegram end-to-end test has been completed.

## Pilot success criteria

The pilot is ready for invited users only when all of the following are true:

1. The test bot receives webhook updates on Cloudflare without a VPS.
2. Private commands, Mini App launch, group commands, challenges, and match decisions pass acceptance tests.
3. Background notifications and message deletion survive Worker restarts and retry transient failures.
4. Analytics can report starts, active users, feature usage, errors, and platform resource consumption without collecting message content.
5. API readiness and Mini App smoke tests pass on the staging deployment.
6. A documented rollback exists that does not require deleting user/game data.

Only after observing actual usage and resource consumption should the project decide whether to remain Cloudflare-only or add one or more Node.js workers/servers. Future multi-bot support should use a bot registry and per-bot secret references; it must not run multiple long-polling processes for one token.
