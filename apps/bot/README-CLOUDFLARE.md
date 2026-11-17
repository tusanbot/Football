# Cloudflare Bot Worker (staging)

This Worker is a webhook adapter for the shared grammY bot application. It is intentionally configured as a separate **staging-only** Worker and does not register or replace any Telegram webhook by itself.

## Staging prerequisites

Do not deploy this Worker until all three staging services exist and are isolated from production:

1. A staging Game API Worker connected to a staging database.
2. A staging Mini App Worker whose URL is used for Telegram Web App buttons.
3. A separate Telegram test bot created for the pilot.

The Wrangler config contains `.example.invalid` placeholders on purpose. Replace them with staging-only API and Mini App URLs before deployment. Never point this config at the current production API/database or the primary Telegram bot during initial tests.

## Required Worker secrets

Set these only after creating the staging Worker and obtaining a separate test bot:

- `TELEGRAM_BOT_TOKEN`: token for the test bot only.
- `TELEGRAM_WEBHOOK_SECRET`: random Telegram webhook secret (1–256 characters from Telegram's allowed set).
- `BOT_API_SECRET`: same server-to-server secret configured on the staging Game API.
- `ANALYTICS_HASH_SECRET`: independent random secret of at least 32 characters, used only to HMAC Telegram user IDs before writing a pseudonymous Analytics Engine index.

No token, raw Telegram ID, message text, or raw update body is written to Analytics Engine. The dataset `football_empire_pilot` is created automatically when the first data point is written.

## Local checks

From the repository root:

```sh
pnpm --filter @football/bot typecheck
pnpm --filter @football/bot test
pnpm --dir apps/web exec wrangler deploy --dry-run --config ../bot/wrangler.jsonc
```

Run locally with:

```sh
pnpm dev:bot-worker
```

The dry-run validates the Worker bundle and configuration; it does not deploy the Worker.

## Runtime behavior

- `POST /telegram/webhook` accepts Telegram updates only when the secret header matches.
- Request bodies are capped at 1 MiB and malformed updates are rejected.
- A Durable Object claims each Telegram `update_id` before dispatch. Completed updates are deduplicated for seven days; failed handlers release their claim so Telegram can retry.
- The Worker checks the staging API readiness endpoint and verifies that the Bot token matches the Bot identity configured in the API.
- A Cron Trigger runs every minute and drains the existing database-backed deletion, match-notification, league-notice, and admin-broadcast queues. These jobs use the existing API claim/complete/fail protocol; they are not process-local timers.
- The current group-message deletion queue is polled on a one-minute schedule, so actual deletion may occur later than the configured 60-second target.
- Worker observability and the Analytics Engine dataset record update starts, command/callback usage, and pseudonymous active-user keys. Mini App page/session analytics and end-to-end retention reporting are not yet implemented; platform Worker metrics can be used for request volume, CPU, duration, and errors in the meantime.

## Activation is intentionally separate

After staging acceptance tests pass, configure the test bot's webhook to:

`https://football-empire-bot-staging.<your-workers-subdomain>.workers.dev/telegram/webhook`

Use Telegram's `secret_token` parameter matching `TELEGRAM_WEBHOOK_SECRET` and the exact `allowed_updates` list:

`message, edited_message, callback_query, chat_member, my_chat_member`

Do not run `setWebhook` against the primary bot as part of CI or deployment. The production bot activation requires a separate explicit approval.
