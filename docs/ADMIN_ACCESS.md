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
