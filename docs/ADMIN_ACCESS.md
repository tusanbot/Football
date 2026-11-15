# Admin access configuration

The central admin API enforces permissions server-side. Keep the super-admin allowlist in `GAME_ADMIN_TELEGRAM_IDS`; those Telegram IDs receive the `superadmin` role.

For scoped administrators, set `GAME_ADMIN_ROLE_MAP` to a JSON object keyed by Telegram user ID. Supported roles:

- `football`: players, clubs, matches and competitions
- `economy`: wallet/group economy and gift codes
- `moderator`: user/group moderation, challenges, alliances and audit views

Example:

```json
{"123456789":"football","987654321":"economy","555555555":"moderator"}
```

Malformed JSON and unknown roles fail closed. A user listed in `GAME_ADMIN_TELEGRAM_IDS` always receives `superadmin` permissions.
\n\n## Admin catalog operations\n\nThe central admin panel supports creating, editing, and activating/deactivating group reward catalog items. Item slugs are stable lowercase identifiers; scope is either `GROUP` or `PERSONAL`. All writes pass through the permission-checked admin action API and create an immutable audit record.\n

## Group gift-code redemption

Gift codes with `GROUP_POINTS` rewards must be redeemed from the target Telegram group by a user who is an active member of that group. The API credits the group's treasury and writes an idempotent `GroupPointLedger` entry with source `GIFT_CODE`. Wallet gift codes remain redeemable in private chat. The bot command is `/redeem CODE`.
