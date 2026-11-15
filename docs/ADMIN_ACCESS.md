# Admin access configuration

The central admin API enforces permissions server-side. Keep the super-admin allowlist in `GAME_ADMIN_TELEGRAM_IDS`; those Telegram IDs always receive the `superadmin` role.

For initial scoped administrators, `GAME_ADMIN_ROLE_MAP` can be set to a JSON object keyed by Telegram user ID. Supported roles:

- `football`: players, clubs, matches and competitions
- `economy`: wallet/group economy and gift codes
- `moderator`: user/group moderation, challenges, alliances and audit views

Example:

```json
{"123456789":"football","987654321":"economy","555555555":"moderator"}
```

Malformed JSON and unknown roles fail closed. Database role assignments take precedence over the environment role map; inactive database assignments explicitly revoke scoped access. Only an environment-allowlisted super-admin can assign or revoke database roles. The database role editor cannot grant the `superadmin` role.

## Admin catalog operations

The central admin panel supports creating, editing, and activating/deactivating group reward catalog items. Item slugs are stable lowercase identifiers; scope is either `GROUP` or `PERSONAL`. All writes pass through the permission-checked admin action API and create an immutable audit record.

## Group gift-code redemption

Gift codes with `GROUP_POINTS` rewards must be redeemed from the target Telegram group by a user who is an active member of that group. The API credits the group's treasury and writes an idempotent `GroupPointLedger` entry with source `GIFT_CODE`. Wallet gift codes remain redeemable in private chat. The bot command is `/redeem CODE`.

## Admin Telegram commands

All admin commands run in private chat and use the same server-side permission checks as the Mini App:

- `/admin`, `/adminlist RESOURCE [QUERY]`
- `/adminuser suspend|restore USER_ID [REASON]`
- `/admingroup suspend|restore GROUP_ID [REASON]`
- `/adminchallenge cancel CHALLENGE_ID`
- `/adminrole assign|revoke TELEGRAM_ID [ROLE]`
- `/adminsetting KEY JSON_VALUE`
- `/adminfinance [DAYS]`
- `/adminbroadcast users|groups TEXT` (persistent queue with retries for group delivery)

## Central settings and finance

Settings are persisted as JSON values in `GameSetting`, are editable only by super-admins, and retain the updating administrator and timestamp. The finance summary aggregates wallet ledger entries, club finance entries, and group-point ledger activity over a selectable period. Game-engine consumers still need to read each setting key before a saved value can change runtime behavior; do not assume an unconsumed key alters game rules.

## Production startup checks

The API process validates required environment variables, establishes a PostgreSQL connection, and runs a database ping before listening. Set `DATABASE_URL` (PostgreSQL), a valid `TELEGRAM_BOT_TOKEN`, a unique random `BOT_API_SECRET` of at least 32 characters, at least one numeric `GAME_ADMIN_TELEGRAM_IDS` super-admin ID, and exact comma-separated `CORS_ORIGIN` values (HTTPS only in production). The Bot process requires `FOOTBALL_API_URL`, the same `BOT_API_SECRET`, and in production an HTTPS `TELEGRAM_WEB_APP_URL`. The API exposes `/health` for liveness and `/ready` for readiness; readiness checks required configuration and a live database connection. Never expose `BOT_API_SECRET` or `TELEGRAM_BOT_TOKEN` to browser code.

## Final launch checklist

1. Provision PostgreSQL and apply migrations with `pnpm db:migrate:deploy`; generate Prisma Client with `pnpm db:generate`.
2. Build all packages with `pnpm build`; run `pnpm test` and `pnpm typecheck` before release.
3. Configure identical `BOT_API_SECRET` values for API and Bot; keep both Telegram secrets server-side only.
4. Start API first and confirm `GET /health` returns 200 and `GET /ready` returns 200.
5. Start the Bot process. It validates the API URL and secret and calls Telegram `getMe` before polling.
6. Ensure the Bot is an administrator in every group where live membership checks, alliance workflows, or group broadcasts are required.
7. Confirm the Mini App URL, Bot username, CORS origins, webhook/polling mode, and public API URL match the production domain. Back up PostgreSQL before every migration.
8. Run a smoke test: Telegram login, account provisioning, club creation, match simulation/checkpoint, league registration, group join, group gift redemption, private notice delivery, group broadcast delivery, and admin audit log.


## Production commands

Run these from the repository root with Node.js 22 and pnpm 10:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm verify
```

Set `NEXT_PUBLIC_API_URL` to the public HTTPS API origin before building the Web app. Set `CORS_ORIGIN` to the exact HTTPS Web origin. Generate the shared secret with `openssl rand -hex 32`; use the same value for API and Bot. Do not reuse the example placeholder.

Build artifacts and process commands:

```bash
pnpm build
pnpm start:api
pnpm start:bot
pnpm start:web
```

Run the three start commands as separate supervised processes (systemd, PM2, or the hosting platform's process manager). Run exactly one Bot polling process per Bot token; the API can run multiple replicas. Add the Bot as a Telegram group administrator with permission to manage group membership and delete its own messages; the Bot subscribes to \`chat_member\` and \`my_chat_member\` updates and disables group functionality if it loses administrator status. The API must become ready before the Bot starts. The Web app is built with `pnpm build`; `start:web` serves that build. The API listens on `API_HOST:API_PORT` (defaults `0.0.0.0:4000`). Verify the public API `/health` and `/ready` endpoints, then open the Mini App through the Bot's `TELEGRAM_WEB_APP_URL`.
