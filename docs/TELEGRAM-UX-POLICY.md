# Telegram interaction policy

## Group message retention
- Bot replies in groups/supergroups are transient by default and deleted 60 seconds after sending.
- Preserve administrative/management announcements and ranking, leaderboard, standings, and league-table messages.
- Classify every new group command explicitly as transient or persistent; default to transient.
- Deletion is best-effort and must not break command execution.

## Private-chat navigation
- Prefer a persistent, resized ReplyKeyboard for primary private-chat navigation.
- Keep slash commands usable alongside keyboard navigation.
- Use InlineKeyboard only for contextual callbacks, confirmations, pagination, and Mini App launch.