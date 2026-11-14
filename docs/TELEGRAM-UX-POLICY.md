# Telegram interaction policy

## Group message retention
- Every bot reply sent through `ctx.reply` in groups/supergroups is transient by default and scheduled for deletion after 60 seconds.
- Group user messages are never deleted by this policy.
- Every current group command is explicitly classified in `apps/bot/src/telegram-ux.ts` as transient or persistent. New group commands must be added to one of those sets and to the command-classification test.
- Preserve administrative/management announcements and ranking, leaderboard, standings, and league-table messages. The source of truth is `PERSISTENT_GROUP_COMMANDS`.
- Unknown/future commands remain transient by default, so a missing classification cannot accidentally leave ordinary replies in the group.
- Deletion is best-effort and must not break command execution. Telegram API errors are logged without failing the command.
- All group replies must use `ctx.reply`, which is wrapped by the retention middleware. Do not use direct `ctx.api.sendMessage`, media-send methods, or `ctx.replyWith*` methods for group responses unless they are routed through the same retention policy and covered by tests.

## Private-chat navigation
- Prefer a persistent, resized Persian ReplyKeyboard for primary private-chat navigation. Every button label must resolve to an existing no-argument private command through the pre-handler text-to-command middleware in `apps/bot/src/bot.ts`.
- Slash commands remain usable alongside keyboard navigation. Commands that require parameters stay documented in `/help` rather than being added as buttons that only return usage errors.
- Keep keyboard labels, command mappings, and retention rules in `apps/bot/src/telegram-ux.ts`; cover them with `apps/bot/test/telegram-ux.test.ts`.
- Use InlineKeyboard only for contextual callbacks, confirmations, pagination, and Mini App launch.
