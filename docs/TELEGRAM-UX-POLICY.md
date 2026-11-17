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
- Use a short category-based InlineKeyboard as the primary navigation. Every category opens a submenu with action buttons and a visible return-to-main-menu button.
- Every action button must execute the same registered command or API operation as its slash-command equivalent. Keep slash commands fully usable for keyboard-first users and advanced users.
- Keep the persistent, resized Persian ReplyKeyboard as a fallback. Its labels must resolve to existing no-argument commands through the text-to-command middleware.
- Prefer button-driven workflows for purchases, league registration, challenge invitations, and club editing. Confirm purchases before debiting a wallet; use idempotency keys for all writes.
- When a workflow needs user input, ask with ForceReply and bind the response to the originating prompt, user, chat, and a short expiry. Never accept an unrelated message as form input.
- Group /start must display group-specific actions instead of rejecting the command. Group membership and administrator-only actions remain verified by Telegram and the API.
- Keep labels, command mappings, and retention rules in `apps/bot/src/telegram-ux.ts`; cover them with `apps/bot/test/telegram-ux.test.ts`.



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

## Staging interaction release
- The store lists catalog items as selectable buttons, shows a confirmation step, and completes purchases through the authenticated store API. Existing `/buyitem` and other slash commands remain available.
- Competition lists expose one-tap registration and creator-only league start actions. Pyramid league tiers and promotion offers are actionable from inline buttons.
- Opponent cards offer direct friendly-match scheduling or a shareable challenge invitation link.
- Club name and logo editing are locked server-side while the club is entered in an active competition. The Bot must show the active competition that causes the lock.
- Group /start exposes status, challenge invitation, group challenge creation/join, group league creation/join, club connection, and group registration.
- Deploy the API and Bot Workers independently to staging. API-only deploys must preserve existing secrets and must never rotate the Telegram webhook secret without a matching explicit webhook registration.
