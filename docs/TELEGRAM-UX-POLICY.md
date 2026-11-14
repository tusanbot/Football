# Telegram interaction policy

## Group message retention
- Every bot reply sent through `ctx.reply` in groups/supergroups is transient by default and scheduled for deletion after 60 seconds.
- Group user messages are never deleted by this policy. The bot must not use unwrapped direct-send methods for ordinary group replies; if a future feature needs `ctx.api.sendMessage` or media sends, route it through the same retention policy or explicitly document why it is persistent.
- Preserve administrative/management announcements and ranking, leaderboard, standings, and league-table messages. The source of truth is `apps/bot/src/telegram-ux.ts`.
- Classify every new group command explicitly as transient or persistent; default to transient. Add a test whenever a new persistent command is introduced.
- Deletion is best-effort and must not break command execution.

## Private-chat navigation
- Prefer a persistent, resized Persian ReplyKeyboard for primary private-chat navigation. Every button label must resolve to an existing no-argument private command through the pre-handler text-to-command middleware in `apps/bot/src/bot.ts`.
- Keep slash commands usable alongside keyboard navigation. Commands that require parameters remain documented in `/help` rather than being added as buttons that only return usage errors.
- Keep keyboard labels, command mappings, and retention rules in `apps/bot/src/telegram-ux.ts`; cover them with `apps/bot/test/telegram-ux.test.ts`.
- Use InlineKeyboard only for contextual callbacks, confirmations, pagination, and Mini App launch.
