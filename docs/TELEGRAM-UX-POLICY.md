# Telegram interaction policy

## Group message retention
- Every bot reply sent through the shared group reply middleware in groups/supergroups is transient by default and scheduled for deletion 60 seconds after sending.
- Preserve administrative/management announcements and ranking, leaderboard, standings, and league-table messages. Keep the command classification list in `apps/bot/src/bot.ts` aligned with new group features.
- Classify every new group command explicitly as transient or persistent; default to transient.
- Deletion is best-effort and must not break command execution.

## Private-chat navigation
- Prefer a persistent, resized ReplyKeyboard for primary private-chat navigation. The keyboard should cover all useful no-argument private commands and expose `/menu` to restore it.
- Keep slash commands usable alongside keyboard navigation. Commands that require parameters remain documented in `/help` rather than being added as buttons that only return usage errors.
- Use InlineKeyboard only for contextual callbacks, confirmations, pagination, and Mini App launch.