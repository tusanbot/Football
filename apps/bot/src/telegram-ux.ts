export const GROUP_REPLY_DELETE_DELAY_MS = 60_000;

const API_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "نشست شما معتبر نیست؛ بازی را دوباره از داخل تلگرام باز کنید.",
  PLAYER_ACCOUNT_SUSPENDED: "دسترسی این حساب به بازی تعلیق شده است.",
  CLUB_NOT_FOUND: "باشگاهی برای حساب شما پیدا نشد.",
  INSUFFICIENT_CASH: "موجودی کش باشگاه کافی نیست.",
  INSUFFICIENT_FUNDS: "موجودی کیف پول کافی نیست.",
  INSUFFICIENT_GOLD: "موجودی طلای شما کافی نیست.",
  STORE_ITEM_NOT_FOUND: "این آیتم در فروشگاه موجود نیست.",
  INVALID_QUANTITY: "تعداد درخواستی معتبر نیست.",
  ITEM_NOT_IN_INVENTORY: "این آیتم در انبار شما موجود نیست.",
  PLAYER_STAT_ALREADY_MAX: "ویژگی بازیکن به حداکثر رسیده و نیازی به این آیتم ندارد.",
  INSUFFICIENT_GROUP_POINTS: "امتیاز خزانه گروه کافی نیست.",
  INSUFFICIENT_BALANCE: "موجودی برای این عملیات کافی نیست.",
  GROUP_NOT_REGISTERED: "این گروه هنوز در بازی ثبت نشده است.",
  GROUP_INACTIVE: "گروه در حال حاضر فعال نیست.",
  GROUP_SUSPENDED: "دسترسی این گروه به بازی تعلیق شده است.",
  GROUP_MANAGER_REQUIRED: "این عملیات فقط برای مدیران ثبت‌شده گروه مجاز است.",
  NOT_GROUP_MEMBER: "ابتدا باید باشگاه خود را به این گروه متصل کنید.",
  GROUP_MINIMUM_MEMBERS_REQUIRED: "تعداد اعضای گروه هنوز به حدنصاب لازم نرسیده است.",
  COMPETITION_NOT_OPEN: "این رقابت در حال حاضر پذیرای ثبت‌نام نیست.",
  COMPETITION_FULL: "ظرفیت این رقابت تکمیل شده است.",
  LEAGUE_NEEDS_FOUR_TEAMS: "برای آغاز لیگ حداقل چهار تیم لازم است.",
  ALL_TEAMS_NEED_VALID_LINEUPS: "همه تیم‌ها باید ترکیب معتبر داشته باشند.",
  BOTH_CLUBS_NEED_VALID_LINEUPS: "هر دو باشگاه باید حداقل یازده بازیکن واجد شرایط داشته باشند.",
  MATCH_NOT_DUE: "زمان شروع این مسابقه هنوز نرسیده است.",
  MATCH_RUNTIME_AUTOMATIC: "این مسابقه به‌صورت خودکار اجرا می‌شود؛ برای مشاهده وضعیت از بخش مسابقات استفاده کنید.",
  MATCH_ALREADY_SIMULATED: "این مسابقه قبلاً اجرا شده است.",
  MATCH_CHECKPOINT_CLOSED: "مهلت ثبت تصمیم تاکتیکی این وقفه به پایان رسیده است.",
  IDEMPOTENCY_CONFLICT: "این درخواست با شناسه تکراری اما اطلاعات متفاوت ارسال شده است.",
  DUPLICATE_OR_IDEMPOTENCY_CONFLICT: "این عملیات قبلاً ثبت شده یا شناسه درخواست تکراری است.",
  CONCURRENT_MODIFICATION: "اطلاعات هم‌زمان تغییر کرده است؛ صفحه را تازه کنید و دوباره تلاش کنید.",
  DAILY_CHALLENGE_LIMIT_REACHED: "سهمیه روزانه ساخت چالش تکمیل شده است.",
  PROMOTION_OFFER_EXPIRED: "مهلت پاسخ به پیشنهاد صعود به پایان رسیده است.",
  PROMOTION_OFFER_ALREADY_RESOLVED: "این پیشنهاد صعود قبلاً تعیین تکلیف شده است.",
  TELEGRAM_GROUP_ACCESS_REVOKED: "عضویت شما در این گروه تأیید نشد.",
  TELEGRAM_GROUP_MANAGER_REQUIRED: "برای این عملیات باید مدیر تلگرام گروه باشید.",
  TELEGRAM_BOT_NOT_GROUP_ADMIN: "ربات باید در گروه مدیر باشد و دسترسی بررسی اعضا داشته باشد.",
};

export function formatApiError(code: string): string {
  return API_ERROR_MESSAGES[code] ?? "درخواست انجام نشد. کد خطا: " + code;
}

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
  [{ label: "🏟 مدیریت باشگاه", command: "menu_club" }, { label: "⚽ مسابقات", command: "menu_matches" }],
  [{ label: "👥 بازیکنان", command: "menu_players" }, { label: "💰 مالی و فروشگاه", command: "menu_economy" }],
  [{ label: "🏆 لیگ‌ها و رکوردها", command: "menu_competitions" }, { label: "❔ راهنما", command: "help" }],
] as const;

export const PRIVATE_MENU_SUBMENUS = {
  menu_club: {
    title: "🏟 مدیریت باشگاه",
    rows: [
      [{ label: "🏟 مشخصات باشگاه", command: "club" }, { label: "📋 ترکیب اصلی", command: "lineup" }],
      [{ label: "🏗 امکانات باشگاه", command: "operations" }, { label: "🔎 استعدادیابی", command: "scout" }],
      [{ label: "📈 توسعه بازیکنان", command: "development" }],
    ],
  },
  menu_players: {
    title: "👥 مدیریت بازیکنان",
    rows: [
      [{ label: "👥 فهرست بازیکنان", command: "players" }, { label: "⭐ بازیکنان ویژه", command: "special" }],
      [{ label: "🧠 برنامه جایگزین", command: "fallback" }, { label: "🛒 بازار نقل‌وانتقالات", command: "market" }],
    ],
  },
  menu_economy: {
    title: "💰 امور مالی و فروشگاه",
    rows: [
      [{ label: "💰 کیف پول", command: "wallet" }, { label: "📊 گزارش مالی", command: "finance" }],
      [{ label: "🛍 فروشگاه", command: "store" }, { label: "🎒 انبار آیتم‌ها", command: "inventory" }],
    ],
  },
  menu_matches: {
    title: "⚽ مسابقات",
    rows: [
      [{ label: "🗓 مسابقات من", command: "matches" }, { label: "⚔️ حریفان", command: "opponents" }],
      [{ label: "🏆 لیگ‌ها", command: "leagues" }, { label: "🧠 تاکتیک جایگزین", command: "fallback" }],
    ],
  },
  menu_competitions: {
    title: "🏆 لیگ‌ها و آمار",
    rows: [
      [{ label: "🏆 لیگ‌ها", command: "leagues" }, { label: "🏅 جوایز فصل", command: "seasonawards" }],
      [{ label: "📊 رکوردهای بازیکنان", command: "records" }, { label: "🏟 باشگاه‌های برتر", command: "clubs" }],
    ],
  },
} as const;

const privateMenuCommands = new Map<string, string>();
for (const item of PRIVATE_MENU_ROWS.flat()) privateMenuCommands.set(normalizePrivateMenuText(item.label), item.command);
for (const menu of Object.values(PRIVATE_MENU_SUBMENUS)) {
  for (const row of menu.rows) for (const item of row) privateMenuCommands.set(normalizePrivateMenuText(item.label), item.command);
}
privateMenuCommands.set(normalizePrivateMenuText("↩️ بازگشت به منوی اصلی"), "menu");

function normalizePrivateMenuText(value: string): string {
  return value.trim().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ");
}

export function resolvePrivateMenuCommand(messageText: string): string | undefined {
  return privateMenuCommands.get(normalizePrivateMenuText(messageText));
}



export function limitTelegramMessage(text: string, maxLength = 3900): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) throw new Error("INVALID_TELEGRAM_MESSAGE_LIMIT");
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "…";
}

export function assertLongPollingWebhookClear(webhookUrl: string | undefined): void {
  if (typeof webhookUrl === "string" && webhookUrl.trim().length > 0) {
    throw new Error("TELEGRAM_WEBHOOK_CONFIGURED: remove the webhook explicitly after confirming the Bot should use long polling.");
  }
}
