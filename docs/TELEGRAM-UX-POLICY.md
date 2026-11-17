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


## Durable deletion queue
- The Bot schedules each transient group reply in PostgreSQL through the authenticated internal API. The API persists the Telegram chat ID, message ID, deletion deadline, retry count, lease, and last error.
- A Bot worker claims due jobs with a database row lock (`FOR UPDATE SKIP LOCKED`). Claims have a 60-second lease so another worker can recover them after a process crash.
- Successful deletions are acknowledged. Already-missing Telegram messages count as successful deletion. Other errors use exponential retry delays; after eight attempts the job is marked failed for investigation.
- If the persistence API is temporarily unavailable while a reply is sent, the Bot uses the old in-memory timer as a best-effort fallback and logs the degraded mode.
- Use `/group-cleanup-test` in a test group to send a transient message. It should disappear after approximately 60 seconds. Use `/group-register` or a league/ranking command to verify that persistent information remains.
- Restart test: send `/group-cleanup-test`, restart the Bot before the minute expires, and verify the message is still deleted after the Bot returns.
- Do not run production migrations or deploy the Bot until the migration has been reviewed and applied to the intended test environment.

## Rich private-chat presentation and navigation
- Prefer Telegram HTML-formatted rich messages for player rosters, club profiles, lineups, competition tables, and other structured game data. Escape all dynamic values before embedding them in HTML.
- Keep a plain-text equivalent for rich-message parse failures; split long player rosters into Telegram-safe chunks before sending.
- Keep the primary menu short and category-based. Inline buttons navigate between the root menu and categories; every category has a visible return-to-main-menu action.
- Keep a persistent ReplyKeyboard as a fallback for clients or situations where inline navigation is unavailable. Its buttons must remain mapped to registered, parameter-free commands.
- Avoid putting commands that require arguments on the ReplyKeyboard. Keep those in /help with explicit usage.
