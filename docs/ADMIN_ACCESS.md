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

## Central settings and finance

Settings are persisted as JSON values in `GameSetting`, are editable only by super-admins, and retain the updating administrator and timestamp. The finance summary aggregates wallet ledger entries, club finance entries, and group-point ledger activity over a selectable period. Game-engine consumers still need to read each setting key before a saved value can change runtime behavior; do not assume an unconsumed key alters game rules.
