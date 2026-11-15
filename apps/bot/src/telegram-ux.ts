export const GROUP_REPLY_DELETE_DELAY_MS = 60_000;

// Every group command is classified explicitly. Unknown/future commands remain transient.
export const PERSISTENT_GROUP_COMMANDS = new Set([
  "group-register", "group-check", "group-give", "group-challenges", "group-challenge",
  "group-challenge-complete", "group-challenge-cancel", "group-rewards", "group-treasury",
  "group-league", "group-league-start", "group-league-table", "group-leagues",
  "alliance", "alliance-create", "alliance-invite", "alliance-accept", "alliance-decline",
  "alliance-championship", "alliance-championship-join", "alliance-championship-start",
  "alliance-season-start", "alliance-season-close", "alliance-season-review", "alliance-contribute",
]);

export const TRANSIENT_GROUP_COMMANDS = new Set([
  "group-join", "group", "group-activity", "group-shop", "group-buy", "group-cleanup-test",
  "group-challenge-join", "group-league-join",
]);

const rankingMessagePattern = /(?:\b(?:ranking|leaderboard|standings|rank|league table)\b|رنک|رتبه|جدول)/i;

export function isPersistentGroupReply(command: string | undefined, messageText: string): boolean {
  if (command && PERSISTENT_GROUP_COMMANDS.has(command)) return true;
  return rankingMessagePattern.test(messageText);
}

export const PRIVATE_MENU_ROWS = [
  [{ label: "🏟 باشگاه", command: "club" }, { label: "💰 کیف پول", command: "wallet" }],
  [{ label: "👥 بازیکنان", command: "players" }, { label: "📋 ترکیب", command: "lineup" }],
  [{ label: "📈 توسعه بازیکنان", command: "development" }, { label: "🏗 امکانات باشگاه", command: "operations" }],
  [{ label: "📊 امور مالی", command: "finance" }, { label: "🔎 استعدادیابی", command: "scout" }],
  [{ label: "⚔️ حریفان", command: "opponents" }, { label: "🗓 مسابقات", command: "matches" }],
  [{ label: "🧠 برنامه جایگزین", command: "fallback" }],
  [{ label: "🏆 لیگ‌ها", command: "leagues" }, { label: "🛒 بازار نقل‌وانتقالات", command: "market" }],
  [{ label: "⭐ بازیکنان ویژه", command: "special" }, { label: "❔ راهنما", command: "help" }],
  [{ label: "🏆 رکوردهای بازیکنان", command: "records" }],
  [{ label: "⌂ منوی اصلی", command: "menu" }],
] as const;

const privateMenuCommands = new Map(
  PRIVATE_MENU_ROWS.flat().map(({ label, command }) => [normalizePrivateMenuText(label), command]),
);

function normalizePrivateMenuText(value: string): string {
  return value.trim().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ");
}

export function resolvePrivateMenuCommand(messageText: string): string | undefined {
  return privateMenuCommands.get(normalizePrivateMenuText(messageText));
}
