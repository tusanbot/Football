import { randomUUID } from "node:crypto";
import { readResponseWithinLimit } from "./telegram-file.js";
import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import {
  GROUP_REPLY_DELETE_DELAY_MS,
  isPersistentGroupReply,
  PRIVATE_MENU_ROWS,
  PRIVATE_MENU_SUBMENUS,
  resolvePrivateMenuCommand,
  formatApiError,
  limitTelegramMessage,
} from "./telegram-ux.js";

export type BotAppConfig = {
  token: string;
  webAppUrl?: string;
  apiUrl: string;
  botApiSecret: string;
  environment?: string;
  apiFetch?: (input: URL, init?: RequestInit) => Promise<Response>;
};

export function createBotApp(config: BotAppConfig) {
const token = config.token;
const webAppUrl = config.webAppUrl;
const apiUrl = config.apiUrl;
const botApiSecret = config.botApiSecret;
const apiFetch = config.apiFetch ?? ((input: URL, init?: RequestInit) => fetch(input, init));
let botTelegramId: number | undefined;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required to create the bot.");
if (!apiUrl) throw new Error("FOOTBALL_API_URL is required to create the bot.");
if (!botApiSecret || botApiSecret.length < 32 || /^(replace-with|change-me|your-)/i.test(botApiSecret)) throw new Error("BOT_API_SECRET must be a unique random secret of at least 32 characters.");
let apiEndpoint: URL;
try { apiEndpoint = new URL(apiUrl); } catch { throw new Error("FOOTBALL_API_URL must be a valid absolute URL."); }
if (!["http:", "https:"].includes(apiEndpoint.protocol) || apiEndpoint.origin !== apiUrl || apiEndpoint.username || apiEndpoint.password || apiEndpoint.search || apiEndpoint.hash) throw new Error("FOOTBALL_API_URL must be an absolute HTTP(S) origin without credentials, path, query, or fragment.");
if (config.environment === "production" && apiEndpoint.protocol !== "https:"
  && !["localhost", "127.0.0.1", "::1"].includes(apiEndpoint.hostname)) {
  throw new Error("FOOTBALL_API_URL must use HTTPS outside localhost in production.");
}
if (config.environment === "production" && !webAppUrl) throw new Error("TELEGRAM_WEB_APP_URL is required in production.");
if (webAppUrl) {
  let webAppEndpoint: URL;
  try { webAppEndpoint = new URL(webAppUrl); } catch { throw new Error("TELEGRAM_WEB_APP_URL must be a valid absolute URL."); }
  if (webAppEndpoint.username || webAppEndpoint.password || webAppEndpoint.search || webAppEndpoint.hash || (config.environment === "production" && webAppEndpoint.protocol !== "https:")) throw new Error("TELEGRAM_WEB_APP_URL must not contain credentials, query, or fragment and must use HTTPS in production.");
}
const bot = new Bot(token);
const pendingClubNameEdits = new Map<number, { promptMessageId: number; expiresAt: number }>();
const pendingGroupCreations = new Map<number, { chatId: number; promptMessageId: number; kind: "challenge" | "league"; expiresAt: number }>();
const pendingLineupSelections = new Map<number, { formation: string; playerIds: string[]; lineupVersion: number; players: Array<{ id: string; firstName: string; lastName: string; position: string; overall: number }> }>();
const pendingFallbackEdits = new Map<number, { plan: Record<string, string>; version: number }>();
const pendingTrainingSelections = new Map<number, { playerId: string; focus?: string }>();
const pendingContractSelections = new Map<number, { playerId: string; minWage: string; maxWage: string; days?: number }>();
type EventTournamentPrizeDraft = { placement: number; type: "CASH" | "GOLD" | "HONOR" | "STORE_ITEM" | "SPECIAL_PLAYER"; amount?: string; itemKey?: string; specialPlayerId?: string };
type EventTournamentWizard = {
  promptMessageId: number; stage: "title" | "description" | "registrationDays" | "startsInDays" | "maxParticipants" | "feeAmount" | "prizeAmount" | "itemKey" | "specialPlayerId";
  title?: string; description?: string; registrationDays?: number; startsInDays?: number; maxParticipants?: number;
  feeAsset?: "CASH" | "GOLD" | "HONOR"; feeAmount?: string; prizes: EventTournamentPrizeDraft[];
  placementIndex: number; pendingPrizeType?: EventTournamentPrizeDraft["type"];
};
const pendingEventTournamentWizards = new Map<number, EventTournamentWizard>();
const pendingTournamentFinalizations = new Map<number, { tournamentId: string; participants: Array<{ id: string; displayName: string | null; username: string | null; clubName: string }>; results: Array<{ participantId: string; placement: number; score: number }>; index: number }>();


bot.use(async (ctx, next) => {
  const originalReply = ctx.reply.bind(ctx);
  Object.defineProperty(ctx, "reply", {
    configurable: true,
    value: async (...args: Parameters<typeof ctx.reply>) => {
      const safeArgs = [...args] as Parameters<typeof ctx.reply>;
      if (typeof safeArgs[0] === "string") safeArgs[0] = limitTelegramMessage(safeArgs[0]);
      return originalReply(...safeArgs);
    },
  });
  await next();
});

bot.use(async (ctx, next) => {
  if (ctx.chat?.type === "private" && ctx.message && "text" in ctx.message) {
    const command = resolvePrivateMenuCommand(ctx.message.text);
    if (command) {
      ctx.message.text = `/${command}`;
      ctx.message.entities = [{ type: "bot_command", offset: 0, length: command.length + 1 }];
    }
  }
  await next();
});

bot.use(async (ctx, next) => {
  const chat = ctx.chat;
  if (chat && (chat.type === "group" || chat.type === "supergroup")) {
    const chatId = chat.id;
    const originalReply = ctx.reply.bind(ctx);
    const command = ctx.message?.text?.match(/^\/([a-z0-9_-]+)/i)?.[1]?.toLowerCase() ?? (typeof ctx.callbackQuery?.data === "string" && ctx.callbackQuery.data.startsWith("g:") ? "group-challenges" : undefined);
    Object.defineProperty(ctx, "reply", {
      configurable: true,
      value: async (...args: Parameters<typeof ctx.reply>) => {
        const sent = await originalReply(...args);
        if (!isPersistentGroupReply(command, String(args[0] ?? ""))) {
          await scheduleGroupReplyDeletion(chatId, sent.message_id);
        }
        return sent;
      },
    });
  }
  await next();
});

type ApiPlayer = { id: string; firstName: string; lastName: string; position: string; overall: number; potential: number; status?: string; lineupSlot?: number | null; age?: number; fitness?: number; morale?: number; contractDays?: number; wage?: string };
type ApiListing = { id: string; askingPrice: string; player: ApiPlayer; sellerClub?: { name: string } };

async function api<T>(path: string, telegramId: number, method = "GET", body?: unknown): Promise<T> {
  if (!apiUrl || !botApiSecret) throw new Error("Bot API is not configured. Set FOOTBALL_API_URL and BOT_API_SECRET.");
  let response: Response;
  try {
    response = await apiFetch(new URL(path, apiUrl), {
      method,
      headers: {
        "content-type": "application/json",
        "x-football-bot-secret": botApiSecret,
        "x-telegram-user-id": String(telegramId),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("ارتباط با سرور بازی برقرار نشد یا مهلت پاسخ به پایان رسید. لطفاً دوباره تلاش کنید.");
  }
  const data = await response.json().catch(() => null) as (T & { error?: string; details?: Record<string, string> }) | null;
  if (!data) {
    if (!response.ok) throw new Error(formatApiError(`HTTP_${response.status}`));
    throw new Error("پاسخ سرور بازی قابل خواندن نیست. لطفاً دوباره تلاش کنید.");
  }
  if (!response.ok) {
    const range = data.details?.minimumWeeklyWage ? ` (دستمزد هفتگی مجاز: ${cash(data.details.minimumWeeklyWage)} تا ${cash(data.details.maximumWeeklyWage ?? data.details.minimumWeeklyWage)} کش)` : "";
    throw new Error(formatApiError(data.error ?? `HTTP_${response.status}`) + range);
  }
  return data;
}


async function publicApi<T>(path: string): Promise<T> {
  if (!apiUrl) throw new Error("FOOTBALL_API_URL is not configured.");
  let response: Response;
  try {
    response = await apiFetch(new URL(path, apiUrl), { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("ارتباط با سرور بازی برقرار نشد یا مهلت پاسخ به پایان رسید. لطفاً دوباره تلاش کنید.");
  }
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!data) {
    if (!response.ok) throw new Error(formatApiError(`HTTP_${response.status}`));
    throw new Error("پاسخ سرور بازی قابل خواندن نیست. لطفاً دوباره تلاش کنید.");
  }
  if (!response.ok) throw new Error(formatApiError(data.error ?? `HTTP_${response.status}`));
  return data;
}

async function saveTelegramClubLogo(ctx: Context, fileId: string, mimeType: string, fileSize?: number) {
  if (!ctx.from || ctx.chat?.type !== "private") return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    await ctx.reply("فرمت لوگو باید JPG، PNG یا WEBP باشد.");
    return;
  }
  if (fileSize && fileSize > 512 * 1024) {
    await ctx.reply("حجم لوگو نباید بیشتر از ۵۱۲ کیلوبایت باشد. تصویر را به‌صورت Photo ارسال یا فشرده کنید.");
    return;
  }
  try {
    const telegramFile = await ctx.api.getFile(fileId);
    if (!telegramFile.file_path) throw new Error("TELEGRAM_FILE_PATH_MISSING");
    const downloaded = await fetch("https://api.telegram.org/file/bot" + token + "/" + telegramFile.file_path, { signal: AbortSignal.timeout(15_000) });
    if (!downloaded.ok) throw new Error("TELEGRAM_FILE_DOWNLOAD_FAILED");
    let bytes: Buffer;
    try {
      bytes = Buffer.from(await readResponseWithinLimit(downloaded, 512 * 1024));
    } catch (error) {
      if (error instanceof Error && error.message === "FILE_TOO_LARGE") throw new Error("LOGO_TOO_LARGE");
      throw error;
    }
    await api("/v1/club/logo", ctx.from.id, "PUT", { mimeType, base64: bytes.toString("base64") });
    await ctx.reply("لوگوی باشگاه با موفقیت به‌روزرسانی شد.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای نامشخص";
    await ctx.reply(message === "LOGO_TOO_LARGE" ? "حجم لوگو بیشتر از ۵۱۲ کیلوبایت است."
      : message.includes("CLUB_EDIT_LOCKED_ACTIVE_LEAGUE") ? "🔒 تغییر لوگو تا پایان رقابت فعال غیرفعال است."
      : "ثبت لوگو ناموفق بود: " + message);
  }
}

async function awardGroupActivity(ctx: { chat: { type: string; id: number } | undefined; from: { id: number } | undefined }, activityType: "CHALLENGE_JOIN"|"CHALLENGE_CREATE"|"LEAGUE_JOIN"|"LEAGUE_CREATE"|"MATCH_PLAYED", referenceId: string) {
 if(!ctx.from||!ctx.chat||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;
 try{await api(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/activity/award`,ctx.from.id,"POST",{activityType,referenceId});}
 catch(error){console.warn("Group activity reward skipped:",error instanceof Error?error.message:error);}
}
async function apiSystem<T = unknown>(path:string,body:unknown):Promise<T>{
 if(!apiUrl||!botApiSecret)throw new Error("Bot API is not configured.");
 const response=await apiFetch(new URL(path,apiUrl),{method:"POST",headers:{"content-type":"application/json","x-football-bot-secret":botApiSecret},body:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});
 const data=await response.json() as T & {error?:string};
 if(!response.ok)throw new Error("System API failed ("+response.status+"): "+(data.error??"unknown error"));
 return data as T;
}

async function scheduleGroupReplyDeletion(chatId: number, messageId: number) {
  const deleteAt = new Date(Date.now() + GROUP_REPLY_DELETE_DELAY_MS);
  try {
    await apiSystem("/v1/bot/group-message-deletions", {
      telegramChatId: String(chatId),
      messageId,
      deleteAt: deleteAt.toISOString(),
    });
  } catch (error) {
    console.warn("Could not persist group message deletion; durable deletion was not scheduled:", error instanceof Error ? error.message : error);
  }
}


type LeagueNoticeDelivery = { id: string; telegramId: string; title: string; body: string; claimToken: string };
let leagueNoticeWorkerBusy = false;
async function pollAdminGroupBroadcastQueue() {
  if (!apiUrl || !botApiSecret) return;
  try {
    const result = await apiSystem<{ deliveries: Array<{ id: string; telegramGroupId: string; message: string; claimToken: string }> }>("/v1/bot/admin-group-broadcasts/claim", { limit: 20 });
    for (const delivery of result.deliveries) {
      try {
        await bot.api.sendMessage(Number(delivery.telegramGroupId), delivery.message);
        await apiSystem("/v1/bot/admin-group-broadcasts/" + delivery.id + "/complete", { claimToken: delivery.claimToken });
      } catch (error) {
        try {
          await apiSystem("/v1/bot/admin-group-broadcasts/" + delivery.id + "/fail", {
            claimToken: delivery.claimToken,
            error: error instanceof Error ? error.message.slice(0, 500) : "Telegram delivery failed",
          });
        } catch (ackError) {
          console.error("Could not reschedule admin group broadcast:", ackError);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (error) {
    console.error("Admin group broadcast worker failed:", error);
  }
}

async function pollLeagueNoticeQueue() {
  if (leagueNoticeWorkerBusy || !apiUrl || !botApiSecret) return;
  leagueNoticeWorkerBusy = true;
  try {
    const result = await apiSystem<{ notices: LeagueNoticeDelivery[] }>("/v1/bot/league-notices/claim", { limit: 20 });
    for (const notice of result.notices) {
      const telegramId = Number(notice.telegramId);
      try {
        if (!Number.isSafeInteger(telegramId)) throw new Error("Telegram user id is outside JavaScript safe integer range");
        await bot.api.sendMessage(telegramId, notice.title + "\n\n" + notice.body);
        await apiSystem("/v1/bot/league-notices/" + encodeURIComponent(notice.id) + "/complete", { claimToken: notice.claimToken });
      } catch (error) {
        await apiSystem("/v1/bot/league-notices/" + encodeURIComponent(notice.id) + "/fail", {
          claimToken: notice.claimToken,
          error: error instanceof Error ? error.message : String(error),
        }).catch((failure) => console.warn("Could not reschedule league notice:", failure));
      }
    }
  } catch (error) {
    console.warn("League notification worker failed:", error instanceof Error ? error.message : error);
  } finally {
    leagueNoticeWorkerBusy = false;
  }
}

type TelegramMessageDeletionJob = {
  id: string;
  telegramChatId: string;
  messageId: number;
  claimToken: string;
};

function isTelegramMessageAlreadyGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /message to delete not found|message not found/i.test(message);
}

let deletionWorkerBusy = false;
async function pollGroupMessageDeletionQueue() {
  if (deletionWorkerBusy || !apiUrl || !botApiSecret) return;
  deletionWorkerBusy = true;
  try {
    const result = await apiSystem<{ jobs: TelegramMessageDeletionJob[] }>(
      "/v1/bot/group-message-deletions/claim",
      { limit: 25 },
    );
    for (const job of result.jobs) {
      const chatId = Number(job.telegramChatId);
      if (!Number.isSafeInteger(chatId)) {
        await apiSystem("/v1/bot/group-message-deletions/" + encodeURIComponent(job.id) + "/fail", {
          claimToken: job.claimToken,
          error: "Telegram chat id is outside JavaScript's safe integer range",
        });
        continue;
      }

      try {
        await bot.api.deleteMessage(chatId, job.messageId);
      } catch (error) {
        if (!isTelegramMessageAlreadyGone(error)) {
          try {
            await apiSystem("/v1/bot/group-message-deletions/" + encodeURIComponent(job.id) + "/fail", {
              claimToken: job.claimToken,
              error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            });
          } catch (queueError) {
            console.error("Could not reschedule failed group message deletion:", queueError);
          }
          continue;
        }
      }

      try {
        await apiSystem("/v1/bot/group-message-deletions/" + encodeURIComponent(job.id) + "/complete", {
          claimToken: job.claimToken,
        });
      } catch (error) {
        // The lease expires and the next worker will safely retry; deleting an absent message is idempotent here.
        console.error("Could not acknowledge group message deletion:", error);
      }
    }
  } catch (error) {
    console.warn("Group message deletion queue poll failed:", error instanceof Error ? error.message : error);
  } finally {
    deletionWorkerBusy = false;
  }
}

let matchNotificationWorkerBusy = false;
async function pollMatchCheckpointNotifications() {
  if (matchNotificationWorkerBusy || !apiUrl || !botApiSecret) return;
  matchNotificationWorkerBusy = true;
  try {
    const result = await apiSystem<{ notifications: Array<{
      checkpointId:string; matchId:string; checkpointKey:string; minute:number; deadlineAt:string;
      clubName:string; opponentName:string; telegramUserId:string; side:"HOME"|"AWAY"; attempt:number;
    }> }>("/v1/bot/match-checkpoints/claim", { limit: 25 });
    for (const notification of result.notifications) {
      const acknowledge = (delivered:boolean, error?:string) => apiSystem(
        "/v1/bot/match-checkpoints/ack",
        { checkpointId: notification.checkpointId, side: notification.side, delivered, ...(error ? { error } : {}) },
      );
      const telegramId = Number(notification.telegramUserId);
      if (!Number.isSafeInteger(telegramId)) {
        await acknowledge(false, "INVALID_TELEGRAM_USER_ID").catch((error:unknown) =>
          console.warn("Could not record invalid match notification recipient:", error instanceof Error ? error.message : error));
        continue;
      }
      const keyboard = new InlineKeyboard()
        .text("دفاعی", "mc:" + notification.matchId + ":" + notification.checkpointKey + ":DEFENSIVE")
        .text("متعادل", "mc:" + notification.matchId + ":" + notification.checkpointKey + ":BALANCED")
        .text("هجومی", "mc:" + notification.matchId + ":" + notification.checkpointKey + ":ATTACKING");
      try {
        await bot.api.sendMessage(telegramId,
          "وقفه تاکتیکی مسابقه شما باز شد.\n"
          + notification.clubName + " مقابل " + notification.opponentName
          + "\nدقیقه " + notification.minute + " · مهلت تا " + new Date(notification.deadlineAt).toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran" })
          + "\nبرای انتخاب سریع ذهنیت یکی از گزینه‌ها را بزنید. برای سایر تنظیمات از /tactic و برای تعویض از /sub استفاده کنید.",
          { reply_markup: keyboard });
        await acknowledge(true);
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : "TELEGRAM_SEND_FAILED";
        await acknowledge(false, message.slice(0, 500)).catch((ackError:unknown) =>
          console.warn("Could not persist failed match notification:", ackError instanceof Error ? ackError.message : ackError));
        console.warn("Match checkpoint notification could not be delivered:", message);
      }
    }
  } catch (error) {
    console.warn("Match checkpoint notification poll failed:", error instanceof Error ? error.message : error);
  } finally {
    matchNotificationWorkerBusy = false;
  }
}

let matchResultNotificationWorkerBusy = false;
async function pollMatchResultNotifications() {
  if (matchResultNotificationWorkerBusy || !apiUrl || !botApiSecret) return;
  matchResultNotificationWorkerBusy = true;
  try {
    const result = await apiSystem<{ notifications: Array<{
      id: string; channel: "HOME" | "AWAY" | "GROUP"; telegramChatId: string; claimToken: string; attempt: number;
      match: { id: string; homeClub: string; awayClub: string; homeScore: number | null; awayScore: number | null; completedAt: string | null };
    }> }>("/v1/bot/match-results/claim", { limit: 25 });
    for (const notification of result.notifications) {
      const acknowledge = (delivered: boolean, error?: string) => apiSystem(
        "/v1/bot/match-results/ack",
        { id: notification.id, claimToken: notification.claimToken, delivered, ...(error ? { error } : {}) },
      );
      const telegramId = Number(notification.telegramChatId);
      if (!Number.isSafeInteger(telegramId)) {
        await acknowledge(false, "INVALID_TELEGRAM_CHAT_ID").catch((error: unknown) =>
          console.warn("Could not acknowledge invalid match result recipient:", error instanceof Error ? error.message : error));
        continue;
      }
      const match = notification.match;
      const message = "🏁 <b>نتیجه نهایی مسابقه</b>\n"
        + "<b>" + escapeHtml(match.homeClub) + "</b> " + (match.homeScore ?? "—")
        + " : " + (match.awayScore ?? "—") + " <b>" + escapeHtml(match.awayClub) + "</b>"
        + "\nنوع اعلان: " + (notification.channel === "GROUP" ? "گروه" : "گزارش شخصی")
        + "\nشناسه مسابقه: " + match.id
        + (match.completedAt ? "\nپایان: " + new Date(match.completedAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }) : "");
      try {
        await bot.api.sendMessage(telegramId, message, { parse_mode: "HTML" });
        await acknowledge(true);
      } catch (sendError) {
        const detail = sendError instanceof Error ? sendError.message : "TELEGRAM_SEND_FAILED";
        await acknowledge(false, detail.slice(0, 500)).catch((ackError: unknown) =>
          console.warn("Could not persist failed match result delivery:", ackError instanceof Error ? ackError.message : ackError));
      }
    }
  } catch (error) {
    console.warn("Match result notification poll failed:", error instanceof Error ? error.message : error);
  } finally {
    matchResultNotificationWorkerBusy = false;
  }
}

function privateMenuKeyboard(menu?: keyof typeof PRIVATE_MENU_SUBMENUS) {
  const keyboard = new Keyboard();
  const rows = menu ? PRIVATE_MENU_SUBMENUS[menu].rows : PRIVATE_MENU_ROWS;
  for (const row of rows) {
    for (const item of row) keyboard.text(item.label);
    keyboard.row();
  }
  if (menu) keyboard.text("↩️ بازگشت به منوی اصلی").row();
  if (webAppUrl) keyboard.webApp("🎮 ورود به بازی", webAppUrl);
  return keyboard.resized().persistent();
}
function inlineMenuKeyboard(menu?: keyof typeof PRIVATE_MENU_SUBMENUS) {
  const keyboard = new InlineKeyboard();
  if (menu) {
    for (const row of PRIVATE_MENU_SUBMENUS[menu].rows) {
      for (const item of row) keyboard.text(item.label, "act:" + item.command);
      keyboard.row();
    }
    keyboard.text("↩️ بازگشت به منوی اصلی", "nav:menu");
  } else {
    const entries = Object.entries(PRIVATE_MENU_SUBMENUS);
    entries.forEach(([key, item], index) => {
      keyboard.text(item.title, "nav:" + key);
      if (index % 2 === 1) keyboard.row();
    });
    keyboard.row().text("🛍 فروشگاه", "act:store").text("⚔️ ساخت چالش", "act:challenge");
    keyboard.row().text("🏆 رقابت‌ها", "act:leagues").text("👥 حریفان", "act:opponents");
    keyboard.row().text("❔ راهنما", "nav:help");
  }
  if (webAppUrl) keyboard.row().webApp("🎮 ورود به بازی", webAppUrl);
  return keyboard;
}
function groupStartKeyboard() {
  return new InlineKeyboard()
    .text("🏟 وضعیت گروه", "g:status").text("⚔️ دعوت چالش", "g:challenge").row()
    .text("🎯 چالش‌های گروه", "g:challenges").text("➕ ساخت چالش گروهی", "g:createchallenge").row()
    .text("🏆 لیگ‌های گروه", "g:leagues").text("➕ ساخت لیگ", "g:createleague").row()
    .text("🔗 اتصال باشگاه", "g:join").text("🛠 ثبت گروه", "g:register");
}
async function dispatchMenuCommand(ctx: Context, command: string) {
  if (!ctx.chat || !ctx.from || ctx.chat.type !== "private" || !/^[a-z0-9_-]{1,32}$/.test(command)) return;
  const callbackMessage = ctx.callbackQuery?.message;
  const messageId = callbackMessage && "message_id" in callbackMessage ? callbackMessage.message_id : 1;
  const syntheticUpdate = {
    update_id: ctx.update.update_id + 1,
    message: {
      message_id: messageId, date: Math.floor(Date.now() / 1000), chat: ctx.chat, from: ctx.from,
      text: "/" + command, entities: [{ type: "bot_command", offset: 0, length: command.length + 1 }],
    },
  } as Parameters<typeof bot.handleUpdate>[0];
  await bot.handleUpdate(syntheticUpdate);
}
function cash(value: string) { return BigInt(value).toLocaleString("fa-IR"); }
function playerName(player: ApiPlayer) { return `${player.firstName} ${player.lastName}`; }
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function replyRich(ctx: Context, richText: string, plainText: string, replyMarkup?: Keyboard | InlineKeyboard) {
  try {
    await ctx.reply(richText, { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/can't parse entities|parse entities|unsupported start tag|can't find end of the entity/i.test(message)) throw error;
    await ctx.reply(plainText, replyMarkup ? { reply_markup: replyMarkup } : {});
  }
}

async function sendMiniAppEntry(ctx: Context) {
  if (ctx.chat?.type !== "private" || !webAppUrl) return;
  await ctx.api.setChatMenuButton({
    chat_id: ctx.chat.id,
    menu_button: {
      type: "web_app",
      text: "باز کردن بازی",
      web_app: { url: webAppUrl },
    },
  });
  await ctx.reply("برای ورود به نسخه گرافیکی بازی، دکمه زیر را انتخاب کنید.", {
    reply_markup: new InlineKeyboard().webApp("ورود به Football Empire", webAppUrl),
  });
}

bot.command("miniapp", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  if (!webAppUrl) return ctx.reply("آدرس مینی‌اپ هنوز در تنظیمات ربات ثبت نشده است.");
  await sendMiniAppEntry(ctx);
});

bot.command("start", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    await ctx.reply(
      "⚽ <b>Football Empire وارد زمین شد!</b>\n\n" +
      "اینجا می‌توانید با اعضای گروه رقابت کنید، چالش بسازید، در لیگ گروهی شرکت کنید و امتیاز خزانه گروه را بالا ببرید.\n" +
      "برای مدیریت شخصی باشگاه، روی نام ربات بزنید و آن را در گفت‌وگوی خصوصی باز کنید.",
      { parse_mode: "HTML", reply_markup: groupStartKeyboard() },
    );
    return;
  }
  if (ctx.chat.type !== "private") return;

  try {
    const account = await api<{
      user: { displayName: string };
      club: { name: string; level: number } | null;
      wallets: Array<{ asset: "CASH" | "GOLD" | "HONOR"; balance: string }>;
    }>("/v1/auth/bot", ctx.from.id, "POST", {
      firstName: ctx.from.first_name,
      ...(ctx.from.last_name ? { lastName: ctx.from.last_name } : {}),
      ...(ctx.from.username ? { username: ctx.from.username } : {}),
    });

    const startPayload = String(ctx.match ?? "").trim();
    if (startPayload.startsWith("challenge_")) {
      const tokenValue = startPayload.slice("challenge_".length);
      try {
        const challenge = await api<{ creatorClub: { name: string; level: number }; expiresAt: string; status: string }>(
          `/v1/friendly-challenges/${encodeURIComponent(tokenValue)}`, ctx.from.id,
        );
        const keyboard = new InlineKeyboard().text("⚔️ پذیرش چالش و شروع مسابقه", "challenge:accept:" + tokenValue);
        await ctx.reply(
          "⚔️ <b>دعوت به مسابقه دوستانه</b>\nباشگاه دعوت‌کننده: <b>" + escapeHtml(challenge.creatorClub.name)
            + "</b> · سطح " + challenge.creatorClub.level
            + "\nاعتبار دعوت تا: " + new Date(challenge.expiresAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })
            + "\n\nبرای شروع مسابقه، دکمه پذیرش را انتخاب کن.",
          { parse_mode: "HTML", reply_markup: keyboard },
        );
        return;
      } catch (error) {
        await ctx.reply("دریافت دعوت چالش ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
        return;
      }
    }

    const cashBalance = account.wallets.find((wallet) => wallet.asset === "CASH")?.balance ?? "0";
    const goldBalance = account.wallets.find((wallet) => wallet.asset === "GOLD")?.balance ?? "0";
    const honorBalance = account.wallets.find((wallet) => wallet.asset === "HONOR")?.balance ?? "0";
    const keyboard = privateMenuKeyboard();

    await ctx.reply(
      `سلام ${account.user.displayName}، به Football Empire خوش آمدید!\n\n` +
      `🏟 باشگاه: ${account.club?.name ?? "هنوز ساخته نشده"} · سطح ${account.club?.level ?? 1}\n` +
      `💰 سرمایه: ${cash(cashBalance)} کش · ${cash(goldBalance)} طلا · ${cash(honorBalance)} افتخار\n\n` +
      `🎯 مأموریت شروع: ترکیب ۱۱ نفره‌ات را آماده کن، وارد یک رقابت شو و اولین چالش دوستانه‌ات را بساز.\n` +
      `هر انتخاب را می‌توانی با دکمه انجام بدهی؛ دستورات متنی هم همچنان فعال‌اند.`,
      { reply_markup: keyboard },
    );
    await ctx.reply("🧭 <b>منوی شیشه‌ای Football Empire</b>\nیک دسته را برای ادامه انتخاب کنید. صفحه‌کلید متنی دسته‌بندی‌شده نیز برای دسترسی جایگزین فعال است.", {
      parse_mode: "HTML",
      reply_markup: inlineMenuKeyboard(),
    });
    await sendMiniAppEntry(ctx);
  } catch (error) {
    console.error("Telegram onboarding failed:", error);
    await ctx.reply("دریافت اطلاعات باشگاه انجام نشد. لطفاً چند لحظه دیگر دوباره تلاش کنید.");
  }
});

bot.command("redeem", async (ctx) => {
  if (!ctx.from) return;
  const code = String(ctx.match ?? "").trim();
  if (!code) return ctx.reply("استفاده: /redeem CODE\nبرای کدهای امتیاز گروه، دستور را داخل همان گروه اجرا کنید.");
  const telegramGroupId = ctx.chat.type === "group" || ctx.chat.type === "supergroup" ? String(ctx.chat.id) : undefined;
  try {
    const result = await api<{ reward: { cash: string; gold: string; groupPoints: string }; replayed?: boolean }>(
      "/v1/gift-codes/redeem", ctx.from.id, "POST",
      { code, idempotencyKey: randomUUID(), ...(telegramGroupId ? { telegramGroupId } : {}) },
    );
    const rewards = [
      BigInt(result.reward.cash) > 0n ? "Cash: " + cash(result.reward.cash) : "",
      BigInt(result.reward.gold) > 0n ? "Gold: " + result.reward.gold : "",
      BigInt(result.reward.groupPoints) > 0n ? "امتیاز خزانه گروه: " + result.reward.groupPoints : "",
    ].filter(Boolean);
    await ctx.reply((result.replayed ? "این کد قبلاً ثبت شده بود.\n" : "کد هدیه با موفقیت اعمال شد.\n") + rewards.join("\n"));
  } catch (error) {
    await ctx.reply("اعمال کد هدیه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});


const tournamentPlacements = [1, 2, 3, 0] as const;
async function askTournamentPrize(ctx: Context, state: EventTournamentWizard) {
  if (!ctx.from) return;
  if (state.placementIndex >= tournamentPlacements.length) {
    if (!state.prizes.length) {
      state.placementIndex = 0;
      const prompt = await ctx.reply("باید دست‌کم برای یکی از رتبه‌ها جایزه تعیین شود. جایزه نفر اول را انتخاب کن:", {
        reply_markup: new InlineKeyboard().text("کش", "event-tournament:prize:CASH").text("طلا", "event-tournament:prize:GOLD").text("Honor", "event-tournament:prize:HONOR").row().text("آیتم", "event-tournament:prize:STORE_ITEM").text("بازیکن ویژه", "event-tournament:prize:SPECIAL_PLAYER"),
      });
      state.promptMessageId = prompt.message_id;
      return;
    }
    try {
      const now = Date.now();
      const registrationEndsAt = new Date(now + (state.registrationDays ?? 1) * 86_400_000);
      const startsAt = new Date(now + (state.startsInDays ?? 2) * 86_400_000);
      const result = await api<{ tournament: { id: string; title: string } }>("/v1/admin/event-tournaments", ctx.from.id, "POST", {
        idempotencyKey: randomUUID(), title: state.title, description: state.description,
        ...(state.feeAsset ? { entryFeeAsset: state.feeAsset } : {}), entryFeeAmount: state.feeAmount ?? "0",
        maxParticipants: state.maxParticipants, registrationEndsAt: registrationEndsAt.toISOString(),
        startsAt: startsAt.toISOString(), prizes: state.prizes,
      });
      pendingEventTournamentWizards.delete(ctx.from.id);
      await ctx.reply("✅ تورنمنت «" + result.tournament.title + "» ساخته شد و ثبت‌نام آن آغاز شده است. شناسه: " + result.tournament.id);
    } catch (error) {
      await ctx.reply("ساخت تورنمنت ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
      pendingEventTournamentWizards.delete(ctx.from.id);
    }
    return;
  }
  const placement = tournamentPlacements[state.placementIndex]!;
  const label = placement === 0 ? "سایر شرکت‌کنندگان" : "نفر " + placement;
  const prompt = await ctx.reply("جایزه " + label + " را انتخاب کن:", {
    reply_markup: new InlineKeyboard()
      .text("کش", "event-tournament:prize:CASH").text("طلا", "event-tournament:prize:GOLD").text("Honor", "event-tournament:prize:HONOR").row()
      .text("آیتم فروشگاه", "event-tournament:prize:STORE_ITEM").text("بازیکن ویژه", "event-tournament:prize:SPECIAL_PLAYER").row()
      .text("بدون جایزه", "event-tournament:prize:NONE"),
  });
  state.promptMessageId = prompt.message_id;
}

async function askTournamentText(ctx: Context, state: EventTournamentWizard, promptText: string) {
  const prompt = await ctx.reply(promptText);
  state.promptMessageId = prompt.message_id;
}

const adminOnlyInPrivate = (ctx: Context) => ctx.chat?.type === "private";

bot.command("tournaments", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const data = await api<{ tournaments: Array<{ id: string; title: string; description: string; status: string; entryFeeAsset: string | null; entryFeeAmount: string; maxParticipants: number; participantCount: number; registrationEndsAt: string; startsAt: string; prizes: Array<{ placement: number; type: string; amount: string; itemKey: string | null; specialPlayerId: string | null }>; joined: boolean }> }>("/v1/event-tournaments", ctx.from.id);
    if (!data.tournaments.length) return ctx.reply("در حال حاضر تورنمنت مناسبتی فعالی وجود ندارد.");
    const keyboard = new InlineKeyboard();
    const lines = data.tournaments.map((item) => {
      const fee = item.entryFeeAmount === "0" ? "رایگان" : item.entryFeeAmount + " " + item.entryFeeAsset;
      const status = item.status === "REGISTRATION" ? "ثبت‌نام" : item.status === "ACTIVE" ? "در حال برگزاری" : "پایان‌یافته";
      if (item.status === "REGISTRATION" && !item.joined && item.participantCount < item.maxParticipants) keyboard.text("ثبت‌نام · " + item.title.slice(0, 24), "event-tournament:join:" + item.id).row();
      const prizeLines = item.prizes.map((prize) => { const place = prize.placement === 0 ? "سایرین" : "رتبه " + prize.placement; const reward = ["CASH","GOLD","HONOR"].includes(prize.type) ? prize.amount + " " + prize.type : prize.type === "STORE_ITEM" ? "آیتم " + (prize.itemKey ?? "") : "بازیکن ویژه"; return place + ": " + reward; }).join(" · ");\n      return "🏆 <b>" + escapeHtml(item.title) + "</b>\\n" + escapeHtml(item.description.slice(0, 240)) + "\\nوضعیت: " + status + " · شرکت‌کننده: " + item.participantCount + "/" + item.maxParticipants + "\\nورودی: " + fee + "\\nجوایز: " + escapeHtml(prizeLines || "اعلام نشده") + "\\nپایان ثبت‌نام: " + new Date(item.registrationEndsAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }) + (item.joined ? "\\n✅ شما ثبت‌نام کرده‌اید." : "");
    });
    await ctx.reply(lines.join("\n\n"), { parse_mode: "HTML", ...(keyboard.inline_keyboard.length ? { reply_markup: keyboard } : {}) });
  } catch (error) { await ctx.reply("دریافت تورنمنت‌ها ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("eventtournaments", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  try {
    const data = await api<{ tournaments: Array<{ id: string; title: string; status: string; participantCount: number; registrationEndsAt: string }> }>("/v1/admin/event-tournaments", ctx.from.id);
    const keyboard = new InlineKeyboard().text("➕ ساخت تورنمنت", "event-tournament:create");
    const lines = data.tournaments.map((item) => {
      if (item.status !== "COMPLETED" && item.status !== "CANCELLED") keyboard.row().text("ثبت نتایج · " + item.title.slice(0, 24), "event-tournament:finalize:" + item.id);
      return "• " + item.title + " · " + item.status + " · " + item.participantCount + " شرکت‌کننده\nID: " + item.id;
    });
    await ctx.reply("🏆 مدیریت تورنمنت‌ها\n\n" + (lines.join("\n\n") || "هنوز تورنمنتی ساخته نشده است."), { reply_markup: keyboard });
  } catch (error) { await ctx.reply("دسترسی مدیریت تورنمنت‌ها تأیید نشد: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.callbackQuery(/^event-tournament:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "این عملیات فقط در گفت‌وگوی خصوصی مجاز است." });
  const parts = ctx.callbackQuery.data.split(":");
  const action = parts[1];
  try {
    if (action === "join") {
      const tournamentId = parts[2];
      if (!tournamentId) return ctx.answerCallbackQuery({ text: "شناسه تورنمنت نامعتبر است." });
      const result = await api<{ joined: boolean; replayed: boolean }>("/v1/event-tournaments/" + encodeURIComponent(tournamentId) + "/join", ctx.from.id, "POST", {});
      await ctx.answerCallbackQuery({ text: result.replayed ? "قبلاً ثبت‌نام کرده‌ای." : "ثبت‌نام انجام شد." });
      await ctx.reply(result.replayed ? "ثبت‌نام شما قبلاً ثبت شده بود." : "✅ ثبت‌نام شما در تورنمنت انجام شد.");
      return;
    }
    if (action === "admin-list") {
      const data = await api<{ tournaments: Array<{ id: string; title: string; status: string; participantCount: number }> }>("/v1/admin/event-tournaments", ctx.from.id);
      const keyboard = new InlineKeyboard().text("➕ ساخت تورنمنت", "event-tournament:create");
      const lines = data.tournaments.map((item) => {
        if (item.status !== "COMPLETED" && item.status !== "CANCELLED") keyboard.row().text("ثبت نتایج · " + item.title.slice(0, 24), "event-tournament:finalize:" + item.id);
        return "• " + item.title + " · " + item.status + " · " + item.participantCount + " شرکت‌کننده\nID: " + item.id;
      });
      await ctx.answerCallbackQuery();
      await ctx.reply("🏆 مدیریت تورنمنت‌ها\n\n" + (lines.join("\n\n") || "هنوز تورنمنتی ساخته نشده است."), { reply_markup: keyboard });
      return;
    }
    if (action === "create") {
      const prompt = await ctx.reply("عنوان تورنمنت را ارسال کن (۳ تا ۱۰۰ نویسه).");
      pendingEventTournamentWizards.set(ctx.from.id, { promptMessageId: prompt.message_id, stage: "title", prizes: [], placementIndex: 0 });
      await ctx.answerCallbackQuery({ text: "فرایند ساخت آغاز شد." });
      return;
    }
    if (action === "fee") {
      const state = pendingEventTournamentWizards.get(ctx.from.id);
      if (!state) return ctx.answerCallbackQuery({ text: "فرایند ساخت منقضی شده است." });
      const asset = parts[2];
      if (asset === "FREE") {
        state.feeAmount = "0";
        await ctx.answerCallbackQuery({ text: "ورودی رایگان انتخاب شد." });
        await askTournamentPrize(ctx, state);
        return;
      }
      if (!["CASH", "GOLD", "HONOR"].includes(asset ?? "")) return ctx.answerCallbackQuery({ text: "نوع ورودی معتبر نیست." });
      state.feeAsset = asset as "CASH" | "GOLD" | "HONOR";
      state.stage = "feeAmount";
      await ctx.answerCallbackQuery();
      await askTournamentText(ctx, state, "مقدار ورودی " + asset + " را به عدد صحیح مثبت ارسال کن.");
      return;
    }
    if (action === "prize") {
      const state = pendingEventTournamentWizards.get(ctx.from.id);
      if (!state) return ctx.answerCallbackQuery({ text: "فرایند ساخت منقضی شده است." });
      const type = parts[2];
      if (type === "NONE") {
        state.placementIndex += 1;
        await ctx.answerCallbackQuery({ text: "برای این رتبه جایزه‌ای ثبت نشد." });
        await askTournamentPrize(ctx, state);
        return;
      }
      if (!["CASH", "GOLD", "HONOR", "STORE_ITEM", "SPECIAL_PLAYER"].includes(type ?? "")) return ctx.answerCallbackQuery({ text: "نوع جایزه معتبر نیست." });
      state.pendingPrizeType = type as EventTournamentPrizeDraft["type"];
      if (["CASH", "GOLD", "HONOR"].includes(type ?? "")) {
        state.stage = "prizeAmount";
        await ctx.answerCallbackQuery();
        await askTournamentText(ctx, state, "مقدار جایزه " + type + " را به عدد صحیح مثبت ارسال کن.");
      } else if (type === "STORE_ITEM") {
        const store = await api<{ items: Array<{ key: string; name: string; price: string; asset: string }> }>("/v1/store", ctx.from.id);
        const keyboard = new InlineKeyboard();
        for (const item of store.items) keyboard.text(item.name.slice(0, 24) + " · " + item.asset, "event-tournament:item:" + item.key).row();
        await ctx.answerCallbackQuery();
        await ctx.editMessageText("آیتم جایزه را از فهرست فروشگاه انتخاب کن:", { reply_markup: keyboard });
      } else {
        const store = await api<{ specialPlayers: Array<{ id: string; fullName: string; rarity: string; overall: number }> }>("/v1/store", ctx.from.id);
        const keyboard = new InlineKeyboard();
        for (const player of store.specialPlayers.slice(0, 25)) keyboard.text(player.fullName.slice(0, 22) + " · " + player.overall, "event-tournament:special-player:" + player.id).row();
        await ctx.answerCallbackQuery();
        await ctx.editMessageText("بازیکن ویژه جایزه را انتخاب کن:", { reply_markup: keyboard });
      }
      return;
    }
    if (action === "item" || action === "special-player") {
      const state = pendingEventTournamentWizards.get(ctx.from.id);
      if (!state) return ctx.answerCallbackQuery({ text: "فرایند ساخت منقضی شده است." });
      const placement = tournamentPlacements[state.placementIndex]!;
      if (action === "item" && value && /^[a-z0-9][a-z0-9_-]{1,39}$/i.test(value)) {
        state.prizes.push({ placement, type: "STORE_ITEM", itemKey: value });
      } else if (action === "special-player" && value) {
        state.prizes.push({ placement, type: "SPECIAL_PLAYER", specialPlayerId: value });
      } else return ctx.answerCallbackQuery({ text: "جایزه انتخاب‌شده معتبر نیست." });
      state.pendingPrizeType = undefined; state.placementIndex += 1;
      await ctx.answerCallbackQuery({ text: "جایزه ثبت شد." });
      await askTournamentPrize(ctx, state);
      return;
    }
    if (action === "finalize") {
      const tournamentId = parts[2];
      if (!tournamentId) return ctx.answerCallbackQuery({ text: "شناسه تورنمنت نامعتبر است." });
      const data = await api<{ participants: Array<{ id: string; displayName: string | null; username: string | null; clubName: string }> }>("/v1/admin/event-tournaments/" + encodeURIComponent(tournamentId) + "/participants", ctx.from.id);
      if (!data.participants.length) return ctx.answerCallbackQuery({ text: "شرکت‌کننده‌ای برای ثبت نتایج وجود ندارد.", show_alert: true });
      pendingTournamentFinalizations.set(ctx.from.id, { tournamentId, participants: data.participants, results: [], index: 0 });
      const participant = data.participants[0]!;
      const keyboard = new InlineKeyboard().text("🥇 اول", "event-tournament:rank:1").text("🥈 دوم", "event-tournament:rank:2").text("🥉 سوم", "event-tournament:rank:3").row().text("سایر", "event-tournament:rank:other");
      await ctx.answerCallbackQuery({ text: "ثبت نتایج آغاز شد." });
      await ctx.reply("رتبه باشگاه «" + participant.clubName + "» را انتخاب کن (۱ از " + data.participants.length + "):", { reply_markup: keyboard });
      return;
    }
    if (action === "rank") {
      const state = pendingTournamentFinalizations.get(ctx.from.id);
      if (!state) return ctx.answerCallbackQuery({ text: "فرایند ثبت نتایج منقضی شده است." });
      const participant = state.participants[state.index];
      if (!participant) return ctx.answerCallbackQuery({ text: "شرکت‌کننده‌ای باقی نمانده است." });
      const rawPlacement = parts[2];
      const placement = rawPlacement === "other" ? state.index + 4 : Number(rawPlacement);
      if (![1, 2, 3].includes(placement) && rawPlacement !== "other") return ctx.answerCallbackQuery({ text: "رتبه معتبر نیست." });
      if ([1, 2, 3].includes(placement) && state.results.some((item) => item.placement === placement)) return ctx.answerCallbackQuery({ text: "این رتبه قبلاً ثبت شده است.", show_alert: true });
      state.results.push({ participantId: participant.id, placement, score: 0 });
      state.index += 1;
      if (state.index >= state.participants.length) {
        const result = await api<{ participants: number; awards: number }>("/v1/admin/event-tournaments/" + encodeURIComponent(state.tournamentId) + "/finalize", ctx.from.id, "POST", {
          idempotencyKey: randomUUID(), results: state.results,
        });
        pendingTournamentFinalizations.delete(ctx.from.id);
        await ctx.answerCallbackQuery({ text: "نتایج نهایی و جوایز تسویه شد." });
        await ctx.reply("✅ تورنمنت نهایی شد. شرکت‌کنندگان: " + result.participants + " · جوایز پرداخت‌شده: " + result.awards);
        return;
      }
      const next = state.participants[state.index]!;
      const keyboard = new InlineKeyboard().text("🥇 اول", "event-tournament:rank:1").text("🥈 دوم", "event-tournament:rank:2").text("🥉 سوم", "event-tournament:rank:3").row().text("سایر", "event-tournament:rank:other");
      await ctx.answerCallbackQuery({ text: "رتبه ثبت شد." });
      await ctx.editMessageText("رتبه باشگاه «" + next.clubName + "» را انتخاب کن (" + (state.index + 1) + " از " + state.participants.length + "):", { reply_markup: keyboard });
      return;
    }
    await ctx.answerCallbackQuery({ text: "عملیات معتبر نیست." });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "عملیات انجام نشد.", show_alert: true });
    await ctx.reply("عملیات تورنمنت ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});



bot.command("admin", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  try {
    const data = await api<{ counts: Record<string, number> }>("/v1/admin/overview", ctx.from.id);
    const labels: Record<string, string> = {
      users: "کاربران", clubs: "باشگاه‌ها", players: "بازیکنان", groups: "گروه‌ها",
      challenges: "چالش‌ها", leagues: "مسابقات", items: "آیتم‌ها", giftCodes: "کدهای هدیه",
      flags: "پرچم‌های بررسی", alliances: "اتحادها", matches: "مسابقات انجام‌شده",
      walletTransactions: "تراکنش‌های کیف پول", groupTransactions: "تراکنش‌های امتیاز گروه",
    };
    const rows = Object.entries(data.counts).map(([key, value]) => (labels[key] ?? key) + ": " + value);
    await ctx.reply("پنل مدیریت Football Empire\n\n" + rows.join("\n") + "\n\nبرای فهرست‌ها: /adminlist RESOURCE [QUERY]\nراهنما: /adminhelp", { reply_markup: new InlineKeyboard().text("🏆 مدیریت تورنمنت‌ها", "event-tournament:admin-list") });
  } catch (error) {
    await ctx.reply("دسترسی مدیریت تأیید نشد یا سرویس در دسترس نیست: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("adminlist", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const [resource, ...queryParts] = String(ctx.match ?? "").trim().split(/\s+/);
  const allowed = new Set(["players", "clubs", "users", "groups", "challenges", "leagues", "items", "gift-codes", "alliances", "matches", "alliance-seasons", "wallet-ledger", "group-ledger", "audit", "season-awards", "group-broadcasts"]);
  if (!resource || !allowed.has(resource)) return ctx.reply("استفاده: /adminlist RESOURCE [QUERY]\nمنابع مجاز: " + [...allowed].join(", "));
  try {
    const query = queryParts.join(" ");
    const result = await api<Array<Record<string, unknown>>>(
      "/v1/admin/" + encodeURIComponent(resource) + "?limit=15" + (query ? "&q=" + encodeURIComponent(query) : ""),
      ctx.from.id,
    );
    if (!result.length) return ctx.reply("موردی پیدا نشد.");
    const rows = result.map((item) => {
      const id = String(item.id ?? "—");
      const title = String(item.name ?? item.title ?? item.displayName ?? item.code ?? item.firstName ?? item.telegramId ?? id);
      const status = String(item.status ?? (item.active === false ? "غیرفعال" : ""));
      return "• " + title.slice(0, 90) + (status ? " · " + status : "") + "\nID: " + id;
    });
    await ctx.reply(("نتایج مدیریت · " + resource + "\n\n" + rows.join("\n\n")).slice(0, 3900));
  } catch (error) {
    await ctx.reply("دریافت فهرست ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("adminuser", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const [operation, targetId, ...reasonParts] = String(ctx.match ?? "").trim().split(/\s+/);
  if (!["suspend", "restore"].includes(operation ?? "") || !targetId) {
    return ctx.reply("استفاده: /adminuser suspend|restore USER_ID [REASON]");
  }
  try {
    await api("/v1/admin/actions", ctx.from.id, "POST", {
      action: operation === "suspend" ? "suspend-user" : "restore-user",
      targetId, reason: reasonParts.join(" ") || "Telegram admin command", idempotencyKey: randomUUID(),
    });
    await ctx.reply("وضعیت کاربر با موفقیت به‌روزرسانی شد.");
  } catch (error) {
    await ctx.reply("عملیات انجام نشد: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("admingroup", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const [operation, targetId, ...reasonParts] = String(ctx.match ?? "").trim().split(/\s+/);
  if (!["suspend", "restore"].includes(operation ?? "") || !targetId) {
    return ctx.reply("استفاده: /admingroup suspend|restore GROUP_ID [REASON]");
  }
  try {
    await api("/v1/admin/actions", ctx.from.id, "POST", {
      action: operation === "suspend" ? "suspend-group" : "restore-group",
      targetId, reason: reasonParts.join(" ") || "Telegram admin command", idempotencyKey: randomUUID(),
    });
    await ctx.reply(operation === "restore" ? "تعلیق گروه برداشته شد؛ مدیر گروه باید برای بررسی مجدد تعداد اعضا و دسترسی ربات، دستور /group-check را در همان گروه اجرا کند." : "گروه تعلیق شد و دسترسی‌های آن غیرفعال شدند.");
  } catch (error) {
    await ctx.reply("عملیات انجام نشد: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("adminchallenge", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const [operation, targetId] = String(ctx.match ?? "").trim().split(/\s+/);
  if (operation !== "cancel" || !targetId) return ctx.reply("استفاده: /adminchallenge cancel CHALLENGE_ID");
  try {
    await api("/v1/admin/actions", ctx.from.id, "POST", {
      action: "cancel-challenge", targetId, idempotencyKey: randomUUID(),
    });
    await ctx.reply("چالش لغو شد و بازپرداخت امتیاز در دفترکل ثبت شد.");
  } catch (error) {
    await ctx.reply("لغو چالش ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("adminseason", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const [operation, targetId, argument] = String(ctx.match ?? "").trim().split(/\s+/);
  if (operation === "start" && targetId) {
    const durationDays = argument === undefined ? undefined : Number(argument);
    if (durationDays !== undefined && (!Number.isInteger(durationDays) || durationDays < 7 || durationDays > 90)) return ctx.reply("مدت فصل باید بین ۷ تا ۹۰ روز باشد.");
    try {
      const result = await api<{seasonNumber:number;endsAt:string}>("/v1/admin/actions", ctx.from.id, "POST", {
        action: "start-alliance-season", targetId, ...(durationDays !== undefined ? { durationDays } : {}), idempotencyKey: randomUUID(),
      });
      return ctx.reply("فصل شماره " + result.seasonNumber + " آغاز شد و در " + result.endsAt + " پایان می‌یابد.");
    } catch (error) {
      return ctx.reply("شروع فصل ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
    }
  }
  if (operation === "close" && targetId) {
    try {
      const result = await api<{reviewStatus:string;prize?:string;replayed:boolean}>("/v1/admin/actions", ctx.from.id, "POST", {
        action: "close-alliance-season", targetId, idempotencyKey: randomUUID(),
      });
      return ctx.reply("فصل اتحاد بسته شد. وضعیت بررسی: " + result.reviewStatus + " · جایزه پرداخت‌شده: " + (result.prize ?? "0") +
        (result.reviewStatus === "FLAGGED" ? "\nجایزه تا بررسی امنیتی مسدود است." : ""));
    } catch (error) {
      return ctx.reply("بستن فصل ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
    }
  }
  if (operation === "review" && targetId && ["approve", "reject"].includes(argument ?? "")) {
    try {
      const result = await api<{reviewStatus:string;prize:string;replayed:boolean}>("/v1/admin/actions", ctx.from.id, "POST", {
        action: "review-alliance-season", targetId, review: argument === "approve" ? "APPROVED" : "REJECTED", idempotencyKey: randomUUID(),
      });
      return ctx.reply("بررسی فصل ثبت شد. وضعیت: " + result.reviewStatus + " · جایزه: " + result.prize);
    } catch (error) {
      return ctx.reply("بررسی فصل ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
    }
  }
  await ctx.reply("استفاده: /adminseason start ALLIANCE_ID [DAYS]، /adminseason close SEASON_ID یا /adminseason review SEASON_ID approve|reject");
});

bot.command("adminleague", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const [operation,targetId,status]=String(ctx.match??"").trim().split(/\s+/);
  if(operation!=="status"||!targetId||!["DRAFT","REGISTRATION","ACTIVE","CANCELLED"].includes(status??""))return ctx.reply("استفاده: /adminleague status COMPETITION_ID DRAFT|REGISTRATION|ACTIVE|CANCELLED");
  try{
    await api("/v1/admin/actions",ctx.from.id,"POST",{action:"competition-status",targetId,status,idempotencyKey:randomUUID()});
    await ctx.reply("وضعیت مسابقه تغییر کرد. پایان لیگ‌های هرم به‌صورت خودکار پس از تکمیل همه مسابقات پردازش می‌شود.");
  }catch(error){await ctx.reply("تغییر وضعیت مسابقه ناموفق بود: "+(error instanceof Error?error.message:"خطای نامشخص"));}
});

bot.command("adminaward", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const input=String(ctx.match??"").trim(),space=input.indexOf(" ");
  const operation=space<0?input:input.slice(0,space),rest=space<0?"":input.slice(space+1).trim();
  try {
    if(operation==="remove"&&rest){
      await api("/v1/admin/actions",ctx.from.id,"POST",{action:"remove-season-player-award",targetId:rest,idempotencyKey:randomUUID()});
      return ctx.reply("جایزه رسمی حذف شد.");
    }
    if(operation==="set"){
      const [season,playerId,awardType,awardName,...reason]=rest.split("|").map(x=>x.trim());
      const allowed=["TOP_SCORER","TOP_ASSISTS","PLAYER_OF_SEASON","TEAM_OF_SEASON","FAIR_PLAY","MOST_IMPROVED"];
      if(!season||!playerId||!awardType||!awardName||!allowed.includes(awardType))return ctx.reply("استفاده: /adminaward set YEAR|PLAYER_ID|TYPE|AWARD_NAME|REASON");
      await api("/v1/admin/actions",ctx.from.id,"POST",{action:"set-season-player-award",awardSeason:Number(season),awardPlayerId:playerId,awardType,awardName,awardReason:reason.join("|"),idempotencyKey:randomUUID()});
      return ctx.reply("جایزه رسمی فصل ثبت شد.");
    }
    await ctx.reply("استفاده: /adminaward set YEAR|PLAYER_ID|TYPE|AWARD_NAME|REASON یا /adminaward remove AWARD_ID");
  } catch(error){await ctx.reply("عملیات جایزه ناموفق بود: "+(error instanceof Error?error.message:"خطای نامشخص"));}
});

bot.command("admingift", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const input=String(ctx.match??"").trim(),space=input.indexOf(" ");
  const operation=space<0?input:input.slice(0,space),rest=space<0?"":input.slice(space+1).trim();
  try {
    if(operation==="create"){
      const [code,rewardType,cashAmount,goldAmount,groupPoints,maxRedemptions,perUserLimit,expiresAt]=rest.split("|").map(x=>x.trim());
      if(!code||!rewardType||!maxRedemptions||!perUserLimit)return ctx.reply("استفاده: /admingift create CODE|WALLET یا GROUP_POINTS|CASH|GOLD|GROUP_POINTS|MAX|PER_USER|EXPIRES_ISO");
      if(!["WALLET","GROUP_POINTS"].includes(rewardType))return ctx.reply("نوع پاداش باید WALLET یا GROUP_POINTS باشد.");
      const result=await api<{targetId:string}>("/v1/admin/actions",ctx.from.id,"POST",{action:"create-gift-code",code,rewardType,cashAmount:cashAmount||"0",goldAmount:goldAmount||"0",groupPoints:groupPoints||"0",maxRedemptions:Number(maxRedemptions),perUserLimit:Number(perUserLimit),...(expiresAt?{expiresAt}:{}),idempotencyKey:randomUUID()});
      return ctx.reply("کد هدیه ایجاد شد. شناسه: "+result.targetId);
    }
    if(operation==="toggle"){
      const [id,state]=rest.split(/\s+/);
      if(!id||!["on","off"].includes(state??""))return ctx.reply("استفاده: /admingift toggle GIFT_ID on|off");
      await api("/v1/admin/actions",ctx.from.id,"POST",{action:"toggle-gift-code",targetId:id,active:state==="on",idempotencyKey:randomUUID()});
      return ctx.reply("وضعیت کد هدیه تغییر کرد.");
    }
    await ctx.reply("استفاده: /admingift create CODE|TYPE|CASH|GOLD|GROUP_POINTS|MAX|PER_USER|EXPIRES یا /admingift toggle ID on|off");
  }catch(error){await ctx.reply("مدیریت کد هدیه ناموفق بود: "+(error instanceof Error?error.message:"خطای نامشخص"));}
});

bot.command("adminitem", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const input=String(ctx.match??"").trim(),space=input.indexOf(" ");
  const operation=space<0?input:input.slice(0,space),rest=space<0?"":input.slice(space+1).trim();
  try {
    if(operation==="create"){
      const [itemSlug,itemName,itemDescription,itemCost,itemScope]=rest.split("|").map(x=>x.trim());
      if(!itemSlug||!itemName||!itemDescription||!itemCost||!["PERSONAL","GROUP"].includes(itemScope??""))return ctx.reply("استفاده: /adminitem create SLUG|NAME|DESCRIPTION|COST|PERSONAL یا GROUP");
      const result=await api<{targetId:string}>("/v1/admin/actions",ctx.from.id,"POST",{action:"create-item",itemSlug,itemName,itemDescription,itemCost,itemScope,idempotencyKey:randomUUID()});
      return ctx.reply("آیتم ایجاد شد. شناسه: "+result.targetId);
    }
    if(operation==="update"){
      const [id,itemName,itemDescription,itemCost]=rest.split("|").map(x=>x.trim());
      if(!id||(!itemName&&!itemDescription&&!itemCost))return ctx.reply("استفاده: /adminitem update ID|NAME|DESCRIPTION|COST");
      await api("/v1/admin/actions",ctx.from.id,"POST",{action:"item-update",targetId:id,...(itemName?{itemName}:{}),...(itemDescription?{itemDescription}:{}),...(itemCost?{itemCost}:{}),idempotencyKey:randomUUID()});
      return ctx.reply("آیتم به‌روزرسانی شد.");
    }
    if(operation==="toggle"){
      const [id,state]=rest.split(/\s+/);
      if(!id||!["on","off"].includes(state??""))return ctx.reply("استفاده: /adminitem toggle ITEM_ID on|off");
      await api("/v1/admin/actions",ctx.from.id,"POST",{action:"toggle-item",targetId:id,active:state==="on",idempotencyKey:randomUUID()});
      return ctx.reply("وضعیت آیتم تغییر کرد.");
    }
    await ctx.reply("استفاده: /adminitem create|update|toggle ...");
  }catch(error){await ctx.reply("مدیریت آیتم ناموفق بود: "+(error instanceof Error?error.message:"خطای نامشخص"));}
});

bot.command("adminupdate", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const input=String(ctx.match??"").trim();
  const parts=input.split(/\s+/);
  const resource=parts.shift(),targetId=parts.shift(),json=parts.join(" ");
  const actions:Record<string,{action:string;fields:string[]}>={
    player:{action:"player-update",fields:["firstName","lastName","age","overall","potential","wage","contractDays","fitness","morale"]},
    club:{action:"club-update",fields:["clubName","level","reputation","stadiumLevel","academyLevel","trainingGroundLevel","ticketPrice"]},
    match:{action:"match-update",fields:["scheduledAt","homeScore","awayScore","matchStatus"]},
  };
  const config=resource?actions[resource]:undefined;
  if(!config||!targetId||!json)return ctx.reply("استفاده: /adminupdate player|club|match ID {JSON}");
  try{
    const values=JSON.parse(json) as Record<string,unknown>;
    if(!values||typeof values!=="object"||Array.isArray(values)||Object.keys(values).length===0||Object.keys(values).some(key=>!config.fields.includes(key)))return ctx.reply("فیلدهای مجاز: "+config.fields.join(", "));
    await api("/v1/admin/actions",ctx.from.id,"POST",{action:config.action,targetId,...values,idempotencyKey:randomUUID()});
    await ctx.reply("اطلاعات "+resource+" به‌روزرسانی شد.");
  }catch(error){await ctx.reply("به‌روزرسانی ناموفق بود: "+(error instanceof Error?error.message:"JSON نامعتبر"));}
});

bot.command("adminbroadcast", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const input=String(ctx.match ?? "").trim();
  const firstSpace=input.indexOf(" ");
  if(firstSpace<1)return ctx.reply("استفاده: /adminbroadcast users|groups پیام شما");
  const audience=input.slice(0,firstSpace);
  const message=input.slice(firstSpace+1).trim();
  if(!["users","groups"].includes(audience)||message.length<2)return ctx.reply("مخاطب باید users یا groups باشد و متن حداقل ۲ نویسه داشته باشد.");
  try {
    if(audience==="users"){
      await api("/v1/admin/actions",ctx.from.id,"POST",{action:"broadcast-users",broadcastMessage:message,idempotencyKey:randomUUID()});
      return ctx.reply("پیام در صف اعلان خصوصی کاربران قرار گرفت. ارسال توسط worker اعلان‌ها انجام می‌شود.");
    }
    await api("/v1/admin/actions",ctx.from.id,"POST",{action:"broadcast-groups",broadcastMessage:message,idempotencyKey:randomUUID()});
    await ctx.reply("پیام در صف پایدار ارسال گروهی قرار گرفت. ارسال به‌صورت مرحله‌ای انجام می‌شود و در صورت خطا دوباره تلاش خواهد شد.");
  } catch(error) {
    await ctx.reply("ارسال پیام مدیریتی ناموفق بود: "+(error instanceof Error?error.message:"خطای نامشخص"));
  }
});

bot.command("adminfinance", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const days = Math.max(1, Math.min(365, Number(String(ctx.match ?? "30").trim()) || 30));
  try {
    const data = await api<{wallet:Array<{asset:string;direction:string;total:string;count:number}>;clubFinance:Array<{category:string;direction:string;total:string;count:number}>;groupPoints:Array<{source:string;total:string;count:number}>;walletReconciliation:Array<{asset:string;walletBalance:string;ledgerNet:string;difference:string}>;groupReconciliation:Array<{treasuryBalance:string;ledgerNet:string;difference:string}>;clubArrearsTotal:string}>("/v1/admin/finance-summary?days="+days,ctx.from.id);
    const rows = [
      ...data.wallet.map(x=>"کیف پول · "+x.asset+" · "+x.direction+": "+x.total+" ("+x.count+")"),
      ...data.clubFinance.map(x=>"باشگاه · "+x.category+" · "+x.direction+": "+x.total+" ("+x.count+")"),
      ...data.groupPoints.map(x=>"امتیاز گروه · "+x.source+": "+x.total+" ("+x.count+")"),
      ...data.walletReconciliation.map(x=>"تطبیق "+x.asset+" · موجودی: "+x.walletBalance+" · دفترکل: "+x.ledgerNet+" · اختلاف: "+x.difference),
      ...data.groupReconciliation.map(x=>"تطبیق خزانه گروه · موجودی: "+x.treasuryBalance+" · دفترکل: "+x.ledgerNet+" · اختلاف: "+x.difference),
      "بدهی عملیاتی باشگاه‌ها: "+data.clubArrearsTotal,
    ];
    await ctx.reply(("گزارش مالی "+days+" روز اخیر\n\n"+(rows.join("\n")||"تراکنشی ثبت نشده است.")).slice(0,3900));
  } catch(error) { await ctx.reply("گزارش مالی در دسترس نیست: "+(error instanceof Error?error.message:"خطای نامشخص")); }
});

bot.command("adminrole", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const [operation, telegramId, role] = String(ctx.match ?? "").trim().split(/\s+/);
  if (!telegramId || !["assign","revoke"].includes(operation ?? "") || (operation==="assign"&&!["football","economy","moderator"].includes(role ?? ""))) {
    return ctx.reply("استفاده: /adminrole assign TELEGRAM_ID football|economy|moderator یا /adminrole revoke TELEGRAM_ID");
  }
  try {
    await api("/v1/admin/actions",ctx.from.id,"POST",{
      action:operation==="assign"?"set-admin-role":"revoke-admin-role",
      adminTelegramId:telegramId,...(operation==="assign"?{adminRole:role}:{}),idempotencyKey:randomUUID(),
    });
    await ctx.reply(operation==="assign"?"نقش مدیر ثبت شد.":"دسترسی مدیر لغو شد.");
  } catch(error) { await ctx.reply("تغییر نقش ناموفق بود: "+(error instanceof Error?error.message:"خطای نامشخص")); }
});

bot.command("adminsetting", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const input=String(ctx.match ?? "").trim();
  const split=input.indexOf(" ");
  if(split<1)return ctx.reply('استفاده: /adminsetting KEY JSON_VALUE\nمثال: /adminsetting economy.dailyReward 100');
  const settingKey=input.slice(0,split);
  let settingValue:unknown;
  try { settingValue=JSON.parse(input.slice(split+1)); } catch { return ctx.reply("مقدار باید JSON معتبر باشد."); }
  try {
    await api("/v1/admin/actions",ctx.from.id,"POST",{action:"set-game-setting",settingKey,settingValue,idempotencyKey:randomUUID()});
    await ctx.reply("تنظیم بازی ذخیره شد.");
  } catch(error) { await ctx.reply("ذخیره تنظیم ناموفق بود: "+(error instanceof Error?error.message:"خطای نامشخص")); }
});

bot.command("adminhelp", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  await ctx.reply(
    "راهنمای پنل مدیریت ربات\n/admin — آمار کلی\n/adminlist RESOURCE [QUERY] — فهرست منابع\n" +
    "/adminuser suspend|restore USER_ID [REASON] — تعلیق/رفع تعلیق کاربر\n" +
    "/admingroup suspend|restore GROUP_ID [REASON] — تعلیق/رفع تعلیق گروه\n" +
    "/adminchallenge cancel CHALLENGE_ID — لغو چالش\n" +
    "/adminrole assign|revoke TELEGRAM_ID [ROLE] — مدیریت نقش مدیران\n" +
    "/adminsetting KEY JSON_VALUE — تنظیمات فعال بازی\n" +
    "/adminfinance [DAYS] — گزارش مالی و مغایرت‌گیری\n" +
    "/adminbroadcast users|groups TEXT — ارسال پیام مدیریتی\n" +
    "/adminaward set|remove ... — مدیریت جوایز رسمی فصل\n" +
    "/adminleague status ID STATUS — مدیریت وضعیت مسابقه\n" +
    "/adminseason close|review SEASON_ID ... — چرخه فصل اتحاد و جوایز\n" +
    "/admingift create|toggle ... — مدیریت کدهای هدیه\n" +
    "/adminitem create|update|toggle ... — مدیریت آیتم‌ها\n" +
    "/adminupdate player|club|match ID JSON — ویرایش اطلاعات\n\n" +
    "تمام درخواست‌ها در API با نقش و مجوز مدیر بررسی و در گزارش مدیریتی ثبت می‌شوند. این دستورات فقط در گفت‌وگوی خصوصی فعال‌اند."
  );
});

bot.callbackQuery(/^legacy:claim:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "دریافت جایزه فقط در گفت‌وگوی خصوصی ممکن است." });
  const slug = ctx.callbackQuery.data.slice("legacy:claim:".length);
  try {
    const result = await api<{ acquisition: { specialPlayer: { fullName: string; overall: number }; replayed: boolean } }>(
      "/v1/players/special/challenges/" + encodeURIComponent(slug) + "/claim", ctx.from.id, "POST", {},
    );
    await ctx.answerCallbackQuery({ text: "اسطوره به باشگاه شما پیوست!" });
    await ctx.reply("🏆 <b>" + escapeHtml(result.acquisition.specialPlayer.fullName)
      + "</b> با قدرت " + result.acquisition.specialPlayer.overall
      + " از چالش اسطوره‌ای به باشگاه شما اضافه شد."
      + (result.acquisition.replayed ? "\nاین جایزه قبلاً ثبت شده بود." : ""), { parse_mode: "HTML" });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "شرایط دریافت جایزه کامل نیست." }).catch(() => undefined);
    await ctx.reply("دریافت بازیکن اسطوره‌ای ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^promotion:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "این عملیات فقط در خصوصی در دسترس است." });
  const [, decision, offerId] = ctx.callbackQuery.data.split(":");
  if (!offerId || !["accept", "decline"].includes(decision ?? "")) return ctx.answerCallbackQuery({ text: "پیشنهاد صعود معتبر نیست." });
  try {
    const result = await api<{accepted:boolean}>("/v1/pyramid-leagues/promotions/" + encodeURIComponent(offerId) + "/respond", ctx.from.id, "POST", { accept: decision === "accept" });
    await ctx.answerCallbackQuery({ text: result.accepted ? "صعود تأیید شد." : "انصراف ثبت شد." });
    await ctx.reply(result.accepted ? "🏅 صعود شما تأیید شد." : "انصراف از پیشنهاد صعود ثبت شد.");
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "ثبت پاسخ ناموفق بود." }).catch(() => undefined);
    await ctx.reply("پاسخ به پیشنهاد صعود ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^league:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "این بخش فقط در گفت‌وگوی خصوصی در دسترس است." });
  const [, action, id] = ctx.callbackQuery.data.split(":");
  try {
    if (action === "join" && id) {
      const result = await api<{joined:boolean;replayed:boolean;teams:number}>(`/v1/competitions/${encodeURIComponent(id)}/join`, ctx.from.id, "POST", {});
      await ctx.answerCallbackQuery({ text: "عضویت در رقابت ثبت شد." });
      await ctx.reply("🏆 ثبت‌نام شما در رقابت انجام شد. تعداد تیم‌ها: " + result.teams + (result.replayed ? " · عضویت قبلاً ثبت شده بود." : ""));
      return;
    }
    if (action === "start" && id) {
      const result = await api<{fixturesCreated:number;rounds:number;teams:number}>(`/v1/competitions/${encodeURIComponent(id)}/start`, ctx.from.id, "POST", {});
      await ctx.answerCallbackQuery({ text: "رقابت آغاز شد." });
      await ctx.reply("🚦 لیگ با " + result.teams + " باشگاه آغاز شد. " + result.fixturesCreated + " مسابقه در " + result.rounds + " هفته برنامه‌ریزی شد.");
      return;
    }
    if (action === "apply" && id) {
      const tier = Number(id);
      if (!Number.isInteger(tier) || tier < 1 || tier > 7) return ctx.answerCallbackQuery({ text: "سطح لیگ معتبر نیست." });
      const result = await api<{status:string;waitingTeams:number;requiredTeams:number;fixturesCreated?:number}>("/v1/pyramid-leagues/apply", ctx.from.id, "POST", { tier });
      await ctx.answerCallbackQuery({ text: "درخواست لیگ ثبت شد." });
      await ctx.reply(result.status === "ASSIGNED"
        ? "🏅 درخواست پذیرفته شد و لیگ پایه تشکیل شد. مسابقات برنامه‌ریزی‌شده: " + (result.fixturesCreated ?? 0)
        : "🏅 درخواست ورود به لیگ ثبت شد. " + result.waitingTeams + " تیم از " + result.requiredTeams + " تیم در صف هستند.");
      return;
    }
    await ctx.answerCallbackQuery({ text: "این گزینه معتبر نیست." });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "درخواست انجام نشد." }).catch(() => undefined);
    await ctx.reply("عضویت یا درخواست لیگ ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^opp:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "چالش حریف فقط در گفت‌وگوی خصوصی ساخته می‌شود." });
  const [, action, clubId] = ctx.callbackQuery.data.split(":");
  if (!clubId) return ctx.answerCallbackQuery({ text: "حریف معتبر نیست." });
  try {
    if (action === "match") {
      const result = await api<{match:{id:string;scheduledAt:string}}>("/v1/matches/friendly", ctx.from.id, "POST", {
        opponentClubId: clubId, idempotencyKey: "bot-friendly-" + ctx.from.id + "-" + ctx.update.update_id,
      });
      await ctx.answerCallbackQuery({ text: "مسابقه دوستانه ثبت شد." });
      await ctx.reply("⚽ مسابقه دوستانه برنامه‌ریزی شد. زمان شروع: " + new Date(result.match.scheduledAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }) + "\nشناسه مسابقه: " + result.match.id);
      return;
    }
    if (action === "challenge") {
      const result = await api<{challenge:{token:string;expiresAt:string};asset:string;goldCost:string;shareUrl:string|null}>(
        "/v1/friendly-challenges", ctx.from.id, "POST", { idempotencyKey: randomUUID() },
      );
      const shareUrl = result.shareUrl ?? (bot.botInfo?.username
        ? "https://t.me/" + bot.botInfo.username + "?start=challenge_" + result.challenge.token : null);
      const keyboard = new InlineKeyboard();
      if (shareUrl) keyboard.url("📨 ارسال دعوت به حریف", "https://t.me/share/url?url=" + encodeURIComponent(shareUrl)
        + "&text=" + encodeURIComponent("برای مسابقه Football Empire دعوت شدی!"));
      await ctx.answerCallbackQuery({ text: "لینک دعوت اختصاصی آماده شد." });
      await ctx.reply("⚔️ لینک اختصاصی دعوت چالش ساخته شد.\nاعتبار: "
        + new Date(result.challenge.expiresAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })
        + (shareUrl ? "\n" + shareUrl : "\nنام کاربری ربات تنظیم نشده است."),
        shareUrl ? { reply_markup: keyboard } : {});
      return;
    }
    await ctx.answerCallbackQuery({ text: "گزینه معتبر نیست." });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "عملیات انجام نشد." }).catch(() => undefined);
    await ctx.reply("عملیات حریف ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^challenge:accept:/, async (ctx) => {
  if (!ctx.from) return ctx.answerCallbackQuery({ text: "کاربر معتبر نیست." });
  const token = ctx.callbackQuery.data.slice("challenge:accept:".length);
  if (!token) return ctx.answerCallbackQuery({ text: "لینک چالش معتبر نیست." });
  try {
    const info = await api<{ creatorClub: { name: string }; creatorTelegramId: string; groupTelegramId: string | null }>(
      "/v1/friendly-challenges/" + encodeURIComponent(token), ctx.from.id,
    );
    const accepted = await api<{ match: { id: string; scheduledAt: string } }>(
      "/v1/friendly-challenges/" + encodeURIComponent(token) + "/accept", ctx.from.id, "POST", {},
    );
    const when = new Date(accepted.match.scheduledAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
    const message = "⚔️ چالش پذیرفته شد!\nباشگاه " + info.creatorClub.name
      + " در برابر باشگاه شما قرار گرفت.\nمسابقه وارد صف شروع خودکار شد.\nشناسه: " + accepted.match.id
      + "\nزمان ثبت‌شده: " + when;
    await ctx.answerCallbackQuery({ text: "چالش پذیرفته شد؛ مسابقه ثبت شد." });
    await ctx.reply(message);
    const creatorTelegramId = Number(info.creatorTelegramId);
    if (Number.isSafeInteger(creatorTelegramId) && creatorTelegramId !== ctx.from.id) {
      await ctx.api.sendMessage(creatorTelegramId, "⚔️ دعوت چالش شما پذیرفته شد!\nحریف وارد مسابقه شد. شناسه مسابقه: " + accepted.match.id)
        .catch((error) => console.warn("Could not notify challenge creator:", error));
    }
    if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
      await ctx.api.sendMessage(ctx.from.id, message).catch((error) => console.warn("Could not DM challenge accepter:", error));
    }
    try { await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("✅ چالش پذیرفته شد", "challenge:accepted") }); }
    catch { /* The original message may no longer be editable. */ }
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "پذیرش چالش ناموفق بود." }).catch(() => undefined);
    await ctx.reply("پذیرش چالش ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^inventory:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "انبار شخصی فقط در خصوصی در دسترس است." });
  const parts = ctx.callbackQuery.data.split(":");
  const action = parts[1] ?? "";
  const itemKey = parts[2] ?? "";
  try {
    if (action === "use") {
      const data = await api<{players:Array<{id:string;firstName:string;lastName:string;position:string;overall:number;fitness:number;morale:number;status:string}>}>("/v1/club/players", ctx.from.id);
      const eligible = data.players.filter((player) => player.status === "ACTIVE" || player.status === "INJURED");
      const keyboard = new InlineKeyboard();
      for (const player of eligible.slice(0, 25)) keyboard.text(player.firstName + " " + player.lastName + " · " + player.position + " · " + player.overall, "inventory:apply:" + itemKey + ":" + player.id).row();
      await ctx.answerCallbackQuery();
      await ctx.reply("👤 <b>بازیکن دریافت‌کننده آیتم را انتخاب کن</b>\nآیتم: <b>" + escapeHtml(itemKey) + "</b>\n\n" +
        (eligible.length ? eligible.map((player) => escapeHtml(player.firstName + " " + player.lastName) + " · آمادگی " + player.fitness + " · روحیه " + player.morale).join("\n") : "بازیکن واجد شرایطی وجود ندارد."),
        { parse_mode: "HTML", ...(eligible.length ? { reply_markup: keyboard } : {}) });
      return;
    }
    if (action === "apply") {
      const playerId = parts[3] ?? "";
      if (!playerId) return ctx.answerCallbackQuery({ text: "بازیکن معتبر نیست." });
      const result = await api<{usage:{itemKey:string;inventory:number;player?:{fitness:number;morale:number}}}>("/v1/store/use", ctx.from.id, "POST", {
        itemKey, playerId, idempotencyKey: "tg-use-" + ctx.from.id + "-" + ctx.update.update_id,
      });
      await ctx.answerCallbackQuery({ text: "آیتم با موفقیت استفاده شد." });
      await ctx.reply("✅ آیتم " + result.usage.itemKey + " استفاده شد. آمادگی: " + (result.usage.player?.fitness ?? "—") + " · روحیه: " + (result.usage.player?.morale ?? "—") + " · باقی‌مانده: " + result.usage.inventory);
      return;
    }
    await ctx.answerCallbackQuery({ text: "گزینه معتبر نیست." });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "استفاده از آیتم ناموفق بود." }).catch(() => undefined);
    await ctx.reply("استفاده از آیتم ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^shop:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "خرید فقط در گفت‌وگوی خصوصی انجام می‌شود." });
  const parts = ctx.callbackQuery.data.split(":");
  const action = parts[1] ?? "";
  const itemKey = parts[2] ?? "";
  try {
    if (action === "item") {
      const data = await api<{items:Array<{key:string;name:string;description:string;asset:string;price:string}>}>("/v1/store", ctx.from.id);
      const item = data.items.find((entry) => entry.key === itemKey);
      if (!item) return ctx.answerCallbackQuery({ text: "این آیتم دیگر در فروشگاه موجود نیست." });
      await ctx.answerCallbackQuery();
      const keyboard = new InlineKeyboard()
        .text("✅ تأیید خرید · ۱ عدد", "shop:buy:" + item.key)
        .text("↩️ بازگشت به فروشگاه", "shop:back");
      await ctx.reply(
        `🛍 <b>${escapeHtml(item.name)}</b>\n${escapeHtml(item.description)}\nقیمت: <b>${cash(item.price)}</b> ${item.asset === "CASH" ? "کش" : item.asset === "GOLD" ? "طلا" : "افتخار"}\n\nخرید را تأیید می‌کنی؟`,
        { parse_mode: "HTML", reply_markup: keyboard },
      );
      return;
    }
    if (action === "buy") {
      const data = await api<{purchase:{itemKey:string;quantity:number;balance:string;inventory:number;replayed:boolean}}>("/v1/store/purchase", ctx.from.id, "POST", {
        itemKey, quantity: 1, idempotencyKey: "tg-store-" + ctx.from.id + "-" + ctx.update.update_id,
      });
      await ctx.answerCallbackQuery({ text: "خرید با موفقیت انجام شد." });
      await ctx.editMessageText(
        "✅ <b>خرید موفق</b>\nآیتم: " + escapeHtml(data.purchase.itemKey) + "\nتعداد: " + data.purchase.quantity +
        "\nموجودی کیف پول: " + cash(data.purchase.balance) + "\nموجودی انبار: " + data.purchase.inventory,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🛍 بازگشت به فروشگاه", "shop:back") },
      );
      return;
    }
    if (action === "back") {
      await ctx.answerCallbackQuery();
      await dispatchMenuCommand(ctx, "store");
      return;
    }
    await ctx.answerCallbackQuery({ text: "گزینه خرید معتبر نیست." });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "خرید انجام نشد." }).catch(() => undefined);
    await ctx.reply("خرید ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^market:buy:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "خرید بازیکن فقط در خصوصی انجام می‌شود." });
  const listingId = ctx.callbackQuery.data.slice("market:buy:".length);
  try {
    const result = await api<{purchase:{price:string;replayed:boolean}}>(`/v1/market/listings/${encodeURIComponent(listingId)}/buy`, ctx.from.id, "POST");
    await ctx.answerCallbackQuery({ text: "خرید بازیکن انجام شد." });
    await ctx.reply("⚽ خرید بازیکن موفق بود. مبلغ پرداختی: " + cash(result.purchase.price) + " کش.");
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "خرید ناموفق بود." }).catch(() => undefined);
    await ctx.reply("خرید بازیکن ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^pack:buy:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "خرید بسته فقط در خصوصی انجام می‌شود." });
  const method = ctx.callbackQuery.data.slice("pack:buy:".length);
  if (!["epic_pack", "legendary_pack", "icon_pack"].includes(method)) return ctx.answerCallbackQuery({ text: "بسته معتبر نیست." });
  try {
    const result = await api<{acquisition:{specialPlayer:{fullName:string;rarity:string;overall:number};goldBalance:string}}>("/v1/players/special/acquire", ctx.from.id, "POST", {
      method, idempotencyKey: "tg-pack-" + ctx.from.id + "-" + ctx.update.update_id,
    });
    await ctx.answerCallbackQuery({ text: "بازیکن ویژه جذب شد!" });
    await ctx.reply("✨ بازیکن ویژه " + result.acquisition.specialPlayer.fullName + " جذب شد · قدرت " + result.acquisition.specialPlayer.overall + "\nطلای باقی‌مانده: " + cash(result.acquisition.goldBalance));
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "خرید بسته انجام نشد." }).catch(() => undefined);
    await ctx.reply("خرید بسته ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

const menuActionCommands = new Set([
  ...PRIVATE_MENU_ROWS.flat().map((item) => item.command),
  ...Object.values(PRIVATE_MENU_SUBMENUS).flatMap((menu) => menu.rows.flat().map((item) => item.command)),
  "store", "challenge", "leagues", "opponents",
]);
bot.callbackQuery(/^act:/, async (ctx) => {
  if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "این عملیات را در گفت‌وگوی خصوصی انجام دهید." });
  const command = ctx.callbackQuery.data.slice(4);
  if (!menuActionCommands.has(command)) return ctx.answerCallbackQuery({ text: "این گزینه معتبر نیست." });
  await ctx.answerCallbackQuery();
  try { await dispatchMenuCommand(ctx, command); }
  catch (error) { await ctx.reply("اجرای این گزینه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.callbackQuery(/^g:/, async (ctx) => {
  if (!ctx.from || !ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
    return ctx.answerCallbackQuery({ text: "این گزینه فقط داخل گروه تلگرام کار می‌کند." });
  }
  const groupId = String(ctx.chat.id);
  const data = ctx.callbackQuery.data;
  const parts = data.split(":");
  const action = parts[1] ?? "";
  try {
    if (action === "status") {
      const result = await api<{group:{title:string;memberCount:number;isActive:boolean;points:string};role:string;registeredManagers:number;minimumMembers:number}>("/v1/groups/" + encodeURIComponent(groupId), ctx.from.id);
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `🏟 <b>${escapeHtml(result.group.title)}</b>\nوضعیت: ${result.group.isActive ? "فعال" : "غیرفعال"}\nاعضا: ${result.group.memberCount} · مدیران باشگاه: ${result.registeredManagers}\nخزانه: <b>${cash(result.group.points)}</b> امتیاز\nحداقل اعضا: ${result.minimumMembers}`,
        { parse_mode: "HTML", reply_markup: groupStartKeyboard() },
      );
      return;
    }
    if (action === "challenge") {
      const result = await api<{challenge:{token:string;expiresAt:string};asset:string;goldCost:string;shareUrl:string|null}>(
        "/v1/friendly-challenges", ctx.from.id, "POST", { groupTelegramId: groupId, idempotencyKey: randomUUID() },
      );
      const shareUrl = result.shareUrl ?? (bot.botInfo?.username
        ? "https://t.me/" + bot.botInfo.username + "?start=challenge_" + result.challenge.token : null);
      const keyboard = new InlineKeyboard();
      if (shareUrl) keyboard.url("📨 ارسال لینک اختصاصی", "https://t.me/share/url?url=" + encodeURIComponent(shareUrl) + "&text=" + encodeURIComponent("برای مسابقه Football Empire دعوت شدی!"));
      keyboard.row().text("⚔️ پذیرش چالش در همین گروه", "challenge:accept:" + result.challenge.token);
      await ctx.answerCallbackQuery({ text: "دعوت چالش ساخته شد." });
      await ctx.reply(
        "⚔️ <b>دعوت چالش آماده است!</b>\nهزینه: " + (result.asset === "FREE" ? "رایگان" : result.asset === "GOLD" ? cash(result.goldCost) + " طلا" : "اعتبار چالش") +
        "\nاعتبار تا: " + new Date(result.challenge.expiresAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }) +
        (shareUrl ? "\n\nلینک اختصاصی: " + shareUrl : "\n\nنام کاربری ربات تنظیم نشده است.") +
        "\n\nبازیکنان می‌توانند با دکمه زیر در همین گروه چالش را بپذیرند.",
        { parse_mode: "HTML", reply_markup: keyboard },
      );
      return;
    }
    if (action === "challenges") {
      const result = await api<{challenges:Array<{id:string;title:string;status:string;participants:number;rewardPoints:string;startsAt:string|null;endsAt:string|null}>}>(`/v1/groups/${encodeURIComponent(groupId)}/challenges`, ctx.from.id);
      const keyboard = new InlineKeyboard();
      const open = result.challenges.filter((item) => item.status === "OPEN");
      for (const item of open) keyboard.text("شرکت در «" + item.title.slice(0, 24) + "»", "g:joinchallenge:" + item.id).row();
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "🎯 <b>چالش‌های گروه</b>\n\n" + (result.challenges.map((item) =>
          "• " + escapeHtml(item.title) + " · " + item.participants + " شرکت‌کننده · " + cash(item.rewardPoints) + " امتیاز · " + item.status
        ).join("\n") || "هنوز چالشی در گروه ایجاد نشده است."),
        { parse_mode: "HTML", ...(open.length ? { reply_markup: keyboard } : {}) },
      );
      return;
    }
    if (action === "joinchallenge") {
      const id = parts[2] ?? "";
      if (!id) return ctx.answerCallbackQuery({ text: "شناسه چالش معتبر نیست." });
      await api(`/v1/groups/${encodeURIComponent(groupId)}/challenges/${encodeURIComponent(id)}/join`, ctx.from.id, "POST", {});
      await awardGroupActivity(ctx, "CHALLENGE_JOIN", id);
      await ctx.answerCallbackQuery({ text: "عضویت شما در چالش ثبت شد." });
      await ctx.reply("✅ در چالش گروه ثبت‌نام شدی. برای پیگیری، دکمه چالش‌های گروه را بزن.");
      return;
    }
    if (action === "leagues") {
      const result = await api<{leagues:Array<{id:string;name:string;status:string;maxTeams:number;teams:number;joined:boolean}>}>(`/v1/groups/${encodeURIComponent(groupId)}/leagues`, ctx.from.id);
      const keyboard = new InlineKeyboard();
      const open = result.leagues.filter((item) => item.status === "REGISTRATION" && !item.joined && item.teams < item.maxTeams);
      for (const item of open) keyboard.text("عضویت در «" + item.name.slice(0, 24) + "»", "g:joinleague:" + item.id).row();
      await ctx.answerCallbackQuery();
      await ctx.reply(
        "🏆 <b>لیگ‌های گروه</b>\n\n" + (result.leagues.map((item) =>
          "• " + escapeHtml(item.name) + " · " + item.teams + "/" + item.maxTeams + " تیم · " + item.status + (item.joined ? " · عضو هستید" : "")
        ).join("\n") || "هنوز لیگ گروهی ساخته نشده است."),
        { parse_mode: "HTML", ...(open.length ? { reply_markup: keyboard } : {}) },
      );
      return;
    }
    if (action === "joinleague") {
      const id = parts[2] ?? "";
      if (!id) return ctx.answerCallbackQuery({ text: "شناسه لیگ معتبر نیست." });
      const result = await api<{teams:number}>(`/v1/groups/${encodeURIComponent(groupId)}/leagues/${encodeURIComponent(id)}/join`, ctx.from.id, "POST", {});
      await awardGroupActivity(ctx, "LEAGUE_JOIN", id);
      await ctx.answerCallbackQuery({ text: "عضویت در لیگ ثبت شد." });
      await ctx.reply("🏆 عضویت باشگاه شما در لیگ گروه ثبت شد. تعداد تیم‌ها: " + result.teams);
      return;
    }
    if (action === "join") {
      const memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
      if (!botTelegramId) throw new Error("شناسه ربات هنوز آماده نیست.");
      const botMember = await ctx.api.getChatMember(ctx.chat.id, botTelegramId);
      if (botMember.status !== "creator" && botMember.status !== "administrator") throw new Error("ربات باید مدیر گروه باشد تا عضویت را تأیید کند.");
      const result = await api<{membership:{group:{title:string};role:string;alreadyJoined:boolean;registeredManagers:number}}>("/v1/groups/join", ctx.from.id, "POST", { telegramGroupId: groupId, memberCount });
      await ctx.answerCallbackQuery({ text: "باشگاه شما به گروه متصل شد." });
      await ctx.reply(result.membership.alreadyJoined ? "باشگاه شما از قبل عضو این گروه است." : "✅ باشگاه شما به گروه «" + result.membership.group.title + "» متصل شد.");
      return;
    }
    if (action === "register") {
      const actor = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
      if (actor.status !== "creator" && actor.status !== "administrator") throw new Error("فقط مدیر یا مالک گروه می‌تواند آن را ثبت کند.");
      if (!botTelegramId) throw new Error("شناسه ربات هنوز آماده نیست.");
      const botMember = await ctx.api.getChatMember(ctx.chat.id, botTelegramId);
      if (botMember.status !== "creator" && botMember.status !== "administrator") throw new Error("ابتدا ربات را مدیر گروه کنید.");
      const memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
      const result = await api<{registration:{group:{title:string};minimumMembers:number}}>("/v1/groups/register", ctx.from.id, "POST", {
        telegramGroupId: groupId, title: ctx.chat.title, role: actor.status === "creator" ? "OWNER" : "ADMIN", memberCount,
      });
      await ctx.answerCallbackQuery({ text: "گروه ثبت شد." });
      await ctx.reply("✅ گروه «" + result.registration.group.title + "» در Football Empire ثبت شد. اعضا می‌توانند از دکمه «عضویت باشگاه» استفاده کنند.");
      return;
    }
    if (action === "createchallenge" || action === "createleague") {
      const actor = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
      if (actor.status !== "creator" && actor.status !== "administrator") {
        return ctx.answerCallbackQuery({ text: "ساخت چالش یا لیگ فقط برای مدیران گروه مجاز است.", show_alert: true });
      }
      await ctx.answerCallbackQuery();
      const prompt = await ctx.reply(
        action === "createchallenge"
          ? "🎯 عنوان چالش گروهی را در پاسخ به این پیام بنویس. بازه چالش به‌صورت پیش‌فرض ۷ روز و جایزه صفر امتیاز خواهد بود."
          : "🏆 نام لیگ گروهی را در پاسخ به این پیام بنویس (۳ تا ۴۰ نویسه). ظرفیت پیش‌فرض ۸ تیم است.",
        { reply_markup: { force_reply: true, selective: true } },
      );
      pendingGroupCreations.set(ctx.from.id, {
        chatId: ctx.chat.id, promptMessageId: prompt.message_id,
        kind: action === "createchallenge" ? "challenge" : "league",
        expiresAt: Date.now() + 10 * 60_000,
      });
      return;
    }
    await ctx.answerCallbackQuery({ text: "این گزینه شناخته نشد." });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "عملیات انجام نشد." }).catch(() => undefined);
    await ctx.reply("⚠️ " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^nav:/, async (ctx) => {
  if (ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "این منو فقط در گفت‌وگوی خصوصی در دسترس است." });
  const target = ctx.callbackQuery.data.slice(4);
  if (target === "help") {
    await ctx.answerCallbackQuery();
    await dispatchMenuCommand(ctx, "help");
    return;
  }
  if (target === "menu") {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("⚽ <b>Football Empire</b>\nیک دسته را انتخاب کنید:", {
      parse_mode: "HTML", reply_markup: inlineMenuKeyboard(),
    });
    await ctx.reply("⌨️ <b>منوی متنی جایگزین</b> · اگر دکمه‌های شیشه‌ای در دسترس نبودند، از صفحه‌کلید زیر استفاده کنید.", {
      parse_mode: "HTML", reply_markup: privateMenuKeyboard(),
    });
    return;
  }
  if (!Object.hasOwn(PRIVATE_MENU_SUBMENUS, target)) return ctx.answerCallbackQuery({ text: "این بخش شناخته نشد." });
  const menuKey = target as keyof typeof PRIVATE_MENU_SUBMENUS;
  const menu = PRIVATE_MENU_SUBMENUS[menuKey];
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(menu.title + "\nبرای اجرای گزینه‌ها از صفحه‌کلید متنی زیر استفاده کنید.", {
    reply_markup: inlineMenuKeyboard(menuKey),
  });
  await ctx.reply(menu.title + "\nیکی از گزینه‌های این بخش را انتخاب کنید. برای بازگشت از دکمه بازگشت استفاده کنید.", {
    reply_markup: privateMenuKeyboard(menuKey),
  });
});

for (const menuKey of Object.keys(PRIVATE_MENU_SUBMENUS) as Array<keyof typeof PRIVATE_MENU_SUBMENUS>) {
  bot.command(menuKey, async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const menu = PRIVATE_MENU_SUBMENUS[menuKey];
    await ctx.reply(menu.title + "\nبرای اجرای هر بخش، دکمه شیشه‌ای را انتخاب کن. صفحه‌کلید متنی پایین هم به‌عنوان مسیر جایگزین فعال است.", {
      reply_markup: inlineMenuKeyboard(menuKey),
    });
    await ctx.reply("⌨️ منوی متنی جایگزین · " + menu.title, {
      reply_markup: privateMenuKeyboard(menuKey),
    });
  });
}

bot.command("menu", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  await ctx.reply("⚽ <b>Football Empire</b>\n\nاز منوی شیشه‌ای زیر دسته موردنظر را انتخاب کنید. اگر این دکمه‌ها در دسترس نبودند، منوی متنی جایگزین نیز در پیام بعدی قرار دارد.", {
    parse_mode: "HTML",
    reply_markup: inlineMenuKeyboard(),
  });
  await ctx.reply("⌨️ <b>منوی متنی جایگزین</b> · دسته‌بندی‌شده و همیشه در دسترس", {
    parse_mode: "HTML",
    reply_markup: privateMenuKeyboard(),
  });
  await sendMiniAppEntry(ctx);
});

bot.command("help", async (ctx) => ctx.reply(
  "راهنمای Football Empire\n\n" +
  "🏟 باشگاه و بازیکنان\n" +
  "/club — اطلاعات باشگاه\n/clubedit — ویرایش نام و لوگوی باشگاه (در لیگ فعال قفل می‌شود)\n/wallet — موجودی کش و طلا\n/rename نام جدید — تغییر نام باشگاه\n" +
  "/players — فهرست بازیکنان\n/lineup — ترکیب و تاکتیک‌ها\n/setlineup FORMATION ID1 ... ID11 — ثبت ترکیب اصلی\n" +
  "/development — وضعیت توسعه بازیکنان\n/train PLAYER_ID FOCUS INTENSITY — تمرین بازیکن\n/renew PLAYER_ID DAYS WEEKLY_WAGE — تمدید قرارداد\n" +
  "/operations — امکانات، آکادمی، مربی و حامی مالی\n/finance [DAYS] — گزارش درآمد و هزینه\n" +
  "/upgrade stadium|training|academy — ارتقای امکانات\n/ticket-price PRICE — تعیین قیمت بلیت\n/scout و /recruit — استعدادیابی و جذب بازیکن\n" +
  "/sponsor OFFER_ID — عقد قرارداد حامی مالی\n/coach-upgrade و /hire-coach — مدیریت مربی\n/setlogo — انتخاب یا فوروارد لوگوی باشگاه\n\n" +
  "⚽ مسابقات و لیگ‌ها\n" +
  "/opponents — فهرست حریفان\n/friendly CLUB_ID — زمان‌بندی بازی دوستانه\n/challenge — ساخت چالش دوستانه\n/acceptchallenge TOKEN — پذیرش چالش\n" +
  "/matches — مسابقات، گزارش زنده و تصمیم‌های تاکتیکی\n/tactic MATCH_ID minute-45 mentality=ATTACKING — تغییر تاکتیک در وقفه\n" +
  "/sub MATCH_ID minute-45 OUT_ID IN_ID — تعویض بازیکن؛ حداکثر ۵ تعویض در کل مسابقه\n/play — توضیح اجرای خودکار مسابقات\n" +
  "/league NAME [4-10] — ساخت لیگ\n/cup NAME [4|8] [legs=1|2] — ساخت جام حذفی یک‌مرحله‌ای یا رفت‌وبرگشت\n" +
  "/leagues و /joinleague ID — مشاهده و عضویت در لیگ‌ها\n/startleague ID و /startcup ID — آغاز رقابت\n/table ID — جدول یا براکت جام\n" +
  "/pyramidleagues و /pyramidtable ID — هرم لیگ و جدول آن\n/leaguehistory — تاریخچه و افتخارات لیگ باشگاه\n/leagueapply — درخواست حضور در لیگ پایه\n" +
  "/promotion OFFER_ID accept|decline — پاسخ به پیشنهاد صعود\n/leaguenotices — اعلان‌های لیگ\n/competitionrules ID ... — تنظیم قوانین مسابقه پیش از شروع\n" +
  "/fallback — مشاهده برنامه تاکتیکی جایگزین\n/setfallback key=value — تنظیم تاکتیک جایگزین\n\n" +
  "👥 گروه‌ها و اتحادها\n" +
  "/group-register — ثبت گروه (ویژه مدیران)\n/group-join — اتصال باشگاه به گروه\n/group و /group-activity — وضعیت گروه و امتیاز فعالیت روزانه\n" +
  "/group-shop و /group-buy ITEM [USER_ID] — فروشگاه و دریافت جایزه\n/group-rewards و /group-treasury — پاداش‌ها و خزانه گروه\n/group-give USER_ID ITEM_SLUG — هدیه به عضو گروه\n" +
  "/group-challenges — فهرست چالش‌ها\n/group-challenge TITLE|START_ISO|END_ISO|POINTS — ساخت چالش\n/group-challenge-join ID — عضویت در چالش\n" +
  "/group-challenge-complete ID USER_ID — تسویه چالش\n/group-challenge-cancel ID — لغو چالش\n/group-check — بررسی مجدد اعضا\n" +
  "/group-league NAME [4-10] — ساخت لیگ گروهی\n/group-leagues — فهرست لیگ‌های گروه\n/group-league-join ID و /group-league-start ID — عضویت و آغاز لیگ\n/group-league-table ID — جدول لیگ گروهی\n" +
  "/alliance — وضعیت اتحاد\n/alliance-create NAME و /alliance-invite GROUP_ID — ساخت اتحاد و دعوت گروه\n/alliance-accept ID و /alliance-decline ID — پاسخ به دعوت\n" +
  "/alliance-championship NAME|TEAMS — ساخت قهرمانی بین‌گروهی\n/alliance-championship-join ID و /alliance-championship-start ID — عضویت و آغاز قهرمانی\n" +
  "/alliance-contribute AMOUNT — واریز به خزانه اتحاد\n/alliance-season-start [DAYS] و /alliance-season-close — مدیریت فصل اتحاد\n" +
  "/alliance-season-review SEASON_ID approve|reject — بررسی جایزه مشکوک (ویژه بازبین مجاز)\n\n" +
  "🏆 بازار و آمار\n" +
  "/market — بازار نقل‌وانتقالات\n/sell PLAYER_ID PRICE و /buy LISTING_ID — فروش و خرید بازیکن\n" +
   "/store — فروشگاه آیتم و بازیکن\n/buyitem ITEM_KEY [QUANTITY] — خرید آیتم\n/inventory — انبار آیتم‌ها\n/useitem ITEM_KEY PLAYER_ID — استفاده از آیتم\n" +
  "/special و /pack epic|legendary|icon — بازیکنان ویژه و بسته‌های جذب\n/redeem CODE — استفاده از کد هدیه\n" +
  "/records [goals|assists|appearances|rating] — رکوردهای تاریخی\n/seasonawards [YEAR] — جوایز و تیم منتخب فصل\n" +
  "/clubs و /clubprofile CLUB_ID — باشگاه‌های عمومی و پروفایل\n/clubcompare ID1 ID2 — مقایسه دو باشگاه\n\n" +
  "/miniapp — باز کردن نسخه گرافیکی Football Empire\n\n" +
  "برای بازگشت به منوی دکمه‌ای، /menu را ارسال کنید. امکانات اصلی از ربات و مینی‌اپ در دسترس‌اند."
));

bot.command("group-cleanup-test", async (ctx) => {
  if (!ctx.from || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return;
  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
  if (member.status !== "creator" && member.status !== "administrator") return ctx.reply("فقط مدیران گروه می‌توانند آزمون حذف خودکار را اجرا کنند.");
  await ctx.reply("پیام آزمایشی حذف خودکار Football Empire است. اگر صف حذف فعال باشد، این پیام حدود ۶۰ ثانیه دیگر حذف می‌شود.");
});

bot.command("group-register", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return ctx.reply("برای ثبت گروه، دستور /group-register را داخل همان گروه اجرا کنید.");
  try {
    const memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
    if (!botTelegramId) return ctx.reply("شناسه ربات هنوز آماده نیست؛ چند لحظه دیگر دوباره تلاش کنید.");
    const botMember = await ctx.api.getChatMember(ctx.chat.id, botTelegramId);
    if (botMember.status !== "creator" && botMember.status !== "administrator") return ctx.reply("برای فعال‌سازی کامل، ربات باید مدیر گروه باشد و دسترسی بررسی اعضا داشته باشد.");
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    const role = member.status === "creator" ? "OWNER" : member.status === "administrator" ? "ADMIN" : null;
    if (!role) return ctx.reply("فقط مالک یا مدیر گروه می‌تواند گروه را ثبت کند.");
    const result = await api<{ registration: { group: { title: string; memberCount: number; isActive: boolean; points: string }; role: string; registeredManagers: number; minimumMembers: number } }>("/v1/groups/register", ctx.from.id, "POST", { telegramGroupId: String(ctx.chat.id), title: ctx.chat.title, role, memberCount });
    await ctx.reply("گروه «" + result.registration.group.title + "» به Football Empire متصل شد.\nنقش ثبت‌شده: " + result.registration.role + "\nمدیران باشگاه ثبت‌شده: " + result.registration.registeredManagers + "\n\nاعضا پس از شروع ربات در گفت‌وگوی خصوصی می‌توانند با /group-join عضو شوند.");
  } catch (error) { await ctx.reply("ثبت گروه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("group-join", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return ctx.reply("برای اتصال باشگاه به گروه ثبت‌شده، دستور /group-join را داخل گروه اجرا کنید.");
  try {
    const memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
    if (!botTelegramId) return ctx.reply("شناسه ربات هنوز آماده نیست.");
    const botMember = await ctx.api.getChatMember(ctx.chat.id, botTelegramId);
    if (botMember.status !== "creator" && botMember.status !== "administrator") return ctx.reply("ربات باید مدیر گروه باشد تا عضویت گروه را بررسی کند.");
    const result = await api<{ membership: { group: { title: string }; role: string; registeredManagers: number; memberCount: number; alreadyJoined: boolean } }>("/v1/groups/join", ctx.from.id, "POST", { telegramGroupId: String(ctx.chat.id), memberCount });
    await ctx.reply(result.membership.alreadyJoined ? "باشگاه شما از قبل در گروه «" + result.membership.group.title + "» ثبت شده است. نقش: " + result.membership.role + "." : "باشگاه شما به گروه «" + result.membership.group.title + "» متصل شد. مدیران ثبت‌شده: " + result.membership.registeredManagers + ".");
  } catch (error) { await ctx.reply("اتصال باشگاه به گروه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("group", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return ctx.reply("برای مشاهده وضعیت، دستور /group را داخل گروه ثبت‌شده اجرا کنید.");
  try {
    const result = await api<{ group: { title: string; memberCount: number; isActive: boolean; points: string }; role: string; registeredManagers: number; minimumMembers: number }>("/v1/groups/" + encodeURIComponent(String(ctx.chat.id)), ctx.from.id);
    await ctx.reply("گروه: " + result.group.title + "\nوضعیت: " + (result.group.isActive ? "فعال" : "غیرفعال") + "\nتعداد اعضای تلگرام: " + result.group.memberCount + "\nمدیران باشگاه ثبت‌شده: " + result.registeredManagers + "\nامتیاز خزانه: " + cash(result.group.points) + "\nحداقل اعضای لازم: " + result.minimumMembers);
  } catch (error) { await ctx.reply("دریافت وضعیت گروه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص") + "\nبرای ثبت گروه /group-register و برای اتصال باشگاه /group-join را اجرا کنید."); }
});
bot.command("group-activity", async (ctx) => {
  if (!ctx.from || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return;
  try {
    const result = await api<{ activity: { awarded: boolean; replayed: boolean; points: string; award: string } }>("/v1/groups/activity", ctx.from.id, "POST", { telegramGroupId: String(ctx.chat.id) });
    await ctx.reply(result.activity.awarded ? "فعالیت روزانه ثبت شد؛ ۱ امتیاز به خزانه گروه اضافه شد. موجودی: " + cash(result.activity.points) + " امتیاز." : "فعالیت امروز شما قبلاً محاسبه شده است. موجودی خزانه: " + cash(result.activity.points) + " امتیاز.");
  } catch (error) { await ctx.reply("ثبت فعالیت گروه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("group-shop",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;try{const d=await api<{points:string;items:Array<{slug:string;name:string;cost:string;scope:string}>}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/shop`,ctx.from.id);await ctx.reply("خزانه گروه: "+cash(d.points)+" امتیاز\n"+d.items.map(i=>i.slug+" — "+i.name+" · "+cash(i.cost)+" امتیاز · "+(i.scope==="PERSONAL"?"شخصی":"گروهی")).join("\n"));}catch(e){await ctx.reply("فروشگاه گروه در دسترس نیست: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-buy",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const [itemSlug,recipientTelegramId]=String(ctx.match??"").trim().split(/\s+/);if(!itemSlug)return ctx.reply("روش استفاده: /group-buy ITEM [USER_ID]");try{const d=await api<{item:string;points:string}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/shop/purchase`,ctx.from.id,"POST",{itemSlug,...(recipientTelegramId?{recipientTelegramId}:{}),idempotencyKey:"group-buy:"+randomUUID()});await ctx.reply("آیتم «"+d.item+"» خریداری شد. موجودی خزانه: "+cash(d.points)+" امتیاز.");}catch(e){await ctx.reply("خرید آیتم ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-challenges",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;try{const d=await api<{challenges:Array<{id:string;title:string;status:string;participants:number;rewardPoints:string}>}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges`,ctx.from.id);await ctx.reply(d.challenges.length?d.challenges.map(c=>c.id+" "+c.title+" ["+c.status+"] · "+c.participants+" شرکت‌کننده · "+cash(c.rewardPoints)+" امتیاز").join("\n") :"هنوز چالشی ثبت نشده است.");}catch(e){await ctx.reply("دریافت چالش‌ها ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-challenge",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const [title,startsAt,endsAt,rewardPoints]=String(ctx.match??"").split("|").map(x=>x.trim());if(!title||!startsAt||!endsAt||!rewardPoints)return ctx.reply("روش استفاده: /group-challenge TITLE|START_ISO|END_ISO|POINTS");try{const d=await api<{challenge:{id:string}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges`,ctx.from.id,"POST",{title,startsAt,endsAt,rewardPoints,idempotencyKey:"group-challenge:"+randomUUID()});await awardGroupActivity(ctx,"CHALLENGE_CREATE",d.challenge.id);await ctx.reply("چالش ایجاد شد؛ شناسه: "+d.challenge.id+" · برای عضویت: /group-challenge-join "+d.challenge.id);}catch(e){await ctx.reply("ایجاد چالش ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-challenge-join",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("روش استفاده: /group-challenge-join ID");try{await api(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges/${encodeURIComponent(id)}/join`,ctx.from.id,"POST",{});await awardGroupActivity(ctx,"CHALLENGE_JOIN",id);await ctx.reply("عضویت در چالش ثبت شد.");}catch(e){await ctx.reply("عضویت در چالش ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-challenge-complete",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const [id,winnerTelegramId]=String(ctx.match??"").trim().split(/\s+/);if(!id||!winnerTelegramId)return ctx.reply("روش استفاده: /group-challenge-complete ID WINNER_USER_ID");try{await api(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges/${encodeURIComponent(id)}/complete`,ctx.from.id,"POST",{winnerTelegramId});await ctx.reply("چالش تسویه شد و جایزه ثبت شد.");}catch(e){await ctx.reply("تسویه چالش ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-check",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;try{const m=await ctx.api.getChatMember(ctx.chat.id,ctx.from.id);if(m.status!=="creator"&&m.status!=="administrator")return ctx.reply("این دستور فقط برای مدیران گروه مجاز است.");if(!botTelegramId)return ctx.reply("شناسه ربات هنوز آماده نیست.");const bm=await ctx.api.getChatMember(ctx.chat.id,botTelegramId);if(bm.status!=="creator"&&bm.status!=="administrator")return ctx.reply("ربات باید مدیر گروه باشد تا گروه فعال شود.");const memberCount=await ctx.api.getChatMemberCount(ctx.chat.id);const d=await api<{isActive:boolean;memberCount:number;minimumMembers:number}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/check`,ctx.from.id,"POST",{memberCount});await ctx.reply("وضعیت گروه: "+(d.isActive?"فعال":"غیرفعال")+" · اعضا: "+d.memberCount+" از حداقل "+d.minimumMembers);}catch(e){await ctx.reply("بررسی گروه ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-league",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const m=String(ctx.match??"").trim().match(/^(.*?)(?:\s+(\d+))?$/),name=m?.[1]?.trim(),maxTeams=Number(m?.[2]??8);if(!name||maxTeams<4||maxTeams>10)return ctx.reply("روش استفاده: /group-league NAME [4-10]");try{const d=await api<{competition:{id:string}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues`,ctx.from.id,"POST",{name,maxTeams,idempotencyKey:"group-league:"+randomUUID()});await awardGroupActivity(ctx,"LEAGUE_CREATE",d.competition.id);await ctx.reply("لیگ گروهی ایجاد شد؛ شناسه: "+d.competition.id+" · عضویت: /group-league-join "+d.competition.id);}catch(e){await ctx.reply("ایجاد لیگ گروهی ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-league-join",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("روش استفاده: /group-league-join ID");try{const d=await api<{teams:number}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues/${encodeURIComponent(id)}/join`,ctx.from.id,"POST",{});await awardGroupActivity(ctx,"LEAGUE_JOIN",id);await ctx.reply("عضویت ثبت شد · تعداد تیم‌ها: "+d.teams);}catch(e){await ctx.reply("عضویت در لیگ گروهی ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-league-start",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("روش استفاده: /group-league-start ID");try{const d=await api<{fixturesCreated:number;rounds:number}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues/${encodeURIComponent(id)}/start`,ctx.from.id,"POST",{});await ctx.reply("لیگ آغاز شد · مسابقات: "+d.fixturesCreated+" · هفته‌ها: "+d.rounds);}catch(e){await ctx.reply("آغاز لیگ ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-league-table",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("روش استفاده: /group-league-table ID");try{const d=await api<{competition:{name:string;teams:Array<{rank:number;club:string;points:number;played:number}>}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues/${encodeURIComponent(id)}`,ctx.from.id);await ctx.reply(d.competition.name+"\n"+d.competition.teams.map(t=>t.rank+". "+t.club+" · "+t.points+" امتیاز · "+t.played+" بازی").join("\n"));}catch(e){await ctx.reply("دریافت جدول لیگ ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});


bot.command("group-rewards",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;try{const d=await api<{personal:{points:string;rewards:Array<{item:string;grantedAt:string}>}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/workspace`,ctx.from.id);await ctx.reply("امتیاز شخصی گروه: "+cash(d.personal.points)+"\n"+(d.personal.rewards.map(r=>r.item+" · "+new Date(r.grantedAt).toLocaleDateString("fa-IR")).join("\n")||"هنوز جایزه‌ای دریافت نکرده‌اید."));}catch(e){await ctx.reply("دریافت جوایز ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-treasury",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;try{const d=await api<{group:{points:string;memberCount:number;isActive:boolean};personal:{history:Array<{amount:string;description:string}>}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/workspace`,ctx.from.id);await ctx.reply("خزانه: "+cash(d.group.points)+" امتیاز · اعضا: "+d.group.memberCount+" · وضعیت: "+(d.group.isActive?"فعال":"غیرفعال")+"\n"+d.personal.history.slice(0,6).map(x=>(BigInt(x.amount)>=0n?"+":"")+cash(x.amount)+" · "+x.description).join("\n"));}catch(e){await ctx.reply("دریافت گردش خزانه ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-give",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;const [recipientTelegramId,itemSlug]=String(ctx.match??"").trim().split(/\s+/);if(!recipientTelegramId||!itemSlug)return ctx.reply("روش استفاده: /group-give USER_ID ITEM_SLUG");try{const d=await api<{item:string;points:string}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/shop/purchase`,ctx.from.id,"POST",{itemSlug,recipientTelegramId,idempotencyKey:"group-give:"+randomUUID()});await ctx.reply("جایزه «"+d.item+"» به عضو انتخاب‌شده اهدا شد. موجودی خزانه: "+cash(d.points));}catch(e){await ctx.reply("اهدای جایزه ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-challenge-cancel",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("روش استفاده: /group-challenge-cancel ID");try{const d=await api<{replayed:boolean;points:string}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges/${encodeURIComponent(id)}/cancel`,ctx.from.id,"POST",{});await ctx.reply("چالش لغو شد. امتیاز بازگشتی به خزانه: "+cash(d.points));}catch(e){await ctx.reply("لغو چالش ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});
bot.command("group-leagues",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;try{const d=await api<{leagues:Array<{id:string;name:string;status:string;teams:number;maxTeams:number}>}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues`,ctx.from.id);await ctx.reply(d.leagues.length?d.leagues.map(c=>c.name+" ["+c.status+"] "+c.teams+"/"+c.maxTeams+" · "+c.id).join("\n") :"هنوز لیگ گروهی ثبت نشده است.");}catch(e){await ctx.reply("دریافت لیگ‌های گروهی ناموفق بود: "+(e instanceof Error?e.message:"خطای نامشخص"));}});

bot.command("clubedit", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return ctx.reply("ویرایش باشگاه فقط در گفت‌وگوی خصوصی انجام می‌شود.");
  try {
    const result = await api<{club:{name:string;activeCompetition:{id:string;name:string}|null}|null}>("/v1/me", ctx.from.id);
    if (!result.club) return ctx.reply("ابتدا باشگاه خود را ایجاد کنید.");
    const locked = Boolean(result.club.activeCompetition);
    const keyboard = locked ? undefined : new InlineKeyboard()
      .text("✏️ تغییر نام باشگاه", "clubedit:name")
      .text("🖼 تغییر لوگو", "clubedit:logo");
    await replyRich(
      ctx,
      "⚙️ <b>ویرایش اطلاعات باشگاه</b>\nنام فعلی: <b>" + escapeHtml(result.club.name) + "</b>" +
      (locked ? "\n\n🔒 ویرایش نام غیرفعال است؛ باشگاه در رقابت فعال «" + escapeHtml(result.club.activeCompetition!.name) + "» حضور دارد." :
        "\n\nمی‌توانی نام باشگاه را تغییر بدهی. هنگام حضور در لیگ فعال، ویرایش اطلاعات هویتی قفل می‌شود.") +
      (locked ? "\nدر زمان حضور در رقابت فعال، تغییر نام و لوگو هر دو قفل هستند." : "\nنام و لوگو از همین گفت‌وگو قابل ویرایش‌اند."),
      "ویرایش باشگاه\nنام فعلی: " + result.club.name + (locked ? "\nویرایش قفل است؛ باشگاه در رقابت فعال " + result.club.activeCompetition!.name + " حضور دارد." : "\nنام باشگاه قابل تغییر است."),
      keyboard,
    );
  } catch (error) { await ctx.reply("دریافت وضعیت ویرایش باشگاه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.callbackQuery(/^clubedit:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "ویرایش باشگاه فقط در گفت‌وگوی خصوصی انجام می‌شود." });
  const action = ctx.callbackQuery.data.slice("clubedit:".length);
  try {
    const result = await api<{club:{name:string;activeCompetition:{id:string;name:string}|null}|null}>("/v1/me", ctx.from.id);
    if (!result.club) return ctx.answerCallbackQuery({ text: "باشگاهی برای ویرایش پیدا نشد." });
    if (result.club.activeCompetition) {
      await ctx.answerCallbackQuery({ text: "ویرایش قفل است؛ باشگاه در لیگ فعال حضور دارد.", show_alert: true });
      return;
    }
    if (action === "logo") {
      await ctx.answerCallbackQuery();
      await ctx.reply("🖼 برای تغییر نشان باشگاه، تصویر JPG، PNG یا WEBP را همین‌جا ارسال کن. محدودیت حجم ۵۱۲ کیلوبایت است.");
      return;
    }
    if (action !== "name") return ctx.answerCallbackQuery({ text: "گزینه ویرایش معتبر نیست." });
    await ctx.answerCallbackQuery();
    const prompt = await ctx.reply(
      "✏️ نام جدید باشگاه را ارسال کن (۲ تا ۳۲ نویسه). برای لغو، /menu را بزن.",
      { reply_markup: { force_reply: true, selective: true, input_field_placeholder: "نام جدید باشگاه" } },
    );
    pendingClubNameEdits.set(ctx.from.id, { promptMessageId: prompt.message_id, expiresAt: Date.now() + 10 * 60_000 });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "دریافت وضعیت ویرایش ناموفق بود." }).catch(() => undefined);
    await ctx.reply("ویرایش باشگاه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("club", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای مشاهده باشگاه، دستور /club را در گفت‌وگوی خصوصی اجرا کنید.");
  try {
    const result = await api<{
      club: { name: string; level: number; reputation: number; createdAt: string; activeCompetition: { id: string; name: string } | null } | null;
      user: { displayName: string };
    }>("/v1/me", ctx.from.id);
    if (!result.club) return ctx.reply("هنوز باشگاهی ندارید. برای ساخت باشگاه دستور /start را ارسال کنید.");
    const lock = result.club.activeCompetition ? "\n🔒 ویرایش اطلاعات هویتی تا پایان رقابت «" + result.club.activeCompetition.name + "» غیرفعال است." : "\n✏️ امکان ویرایش اطلاعات باشگاه فعال است.";
    const plain = `🏟 باشگاه: ${result.club.name}\nمدیر: ${result.user.displayName}\nسطح: ${result.club.level}\nاعتبار: ${result.club.reputation}\nتاریخ تأسیس: ${new Date(result.club.createdAt).toLocaleDateString("fa-IR")}` + lock;
    const rich = `🏟 <b>${escapeHtml(result.club.name)}</b>\nمدیر: <b>${escapeHtml(result.user.displayName)}</b>\nسطح باشگاه: <b>${result.club.level}</b>\nاعتبار: <b>${result.club.reputation}</b>\nتاریخ تأسیس: ${new Date(result.club.createdAt).toLocaleDateString("fa-IR")}` + escapeHtml(lock);
    const clubKeyboard = result.club.activeCompetition ? undefined : new InlineKeyboard().text("⚙️ ویرایش اطلاعات باشگاه", "act:clubedit");
    await replyRich(ctx, rich, plain, clubKeyboard);
  } catch (error) {
    await ctx.reply(`دریافت اطلاعات باشگاه ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`);
  }
});

bot.command("store", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return ctx.reply("فروشگاه شخصی را در گفت‌وگوی خصوصی با ربات باز کنید.");
  try {
    const data = await api<{
      items: Array<{ key: string; name: string; description: string; asset: string; price: string }>;
      wallets: Array<{ asset: string; balance: string }>;
      playerListings: Array<{ id: string; askingPrice: string; player: { firstName: string; lastName: string; overall: number }; sellerClub: { name: string } }>;
      packOffers: Array<{ method: string; rarity: string; priceGold: string }>;
    }>("/v1/store", ctx.from.id);
    const balances = data.wallets.map((w) => (w.asset === "CASH" ? "کش" : w.asset === "GOLD" ? "طلا" : "افتخار") + ": " + cash(w.balance)).join(" · ");
    const keyboard = new InlineKeyboard();
    for (const item of data.items) keyboard.text("🛒 " + item.name, "shop:item:" + item.key).row();
    const descriptions = data.items.map((item) =>
      `<b>${escapeHtml(item.name)}</b>\n${escapeHtml(item.description)}\nقیمت: <b>${cash(item.price)}</b> ${item.asset === "CASH" ? "کش" : item.asset === "GOLD" ? "طلا" : "افتخار"}`
    );
    await replyRich(
      ctx,
      "🛍 <b>فروشگاه Football Empire</b>\n" + escapeHtml(balances) + "\n\n" + (descriptions.join("\n\n") || "فعلاً آیتمی در فروشگاه نیست.") + "\n\nبرای مشاهده جزئیات و خرید، روی آیتم دلخواه بزن.",
      "🛍 فروشگاه Football Empire\n" + balances + "\n\n" + data.items.map((item) => item.name + " · " + item.description + " · " + cash(item.price)).join("\n") + "\nبرای خرید یکی از دکمه‌ها را انتخاب کنید.",
      keyboard,
    );
    if (data.playerListings.length) {
      const marketKeyboard = new InlineKeyboard();
      for (const listing of data.playerListings.slice(0, 8)) {
        marketKeyboard.text("⚽ " + listing.player.firstName + " · " + cash(listing.askingPrice), "market:buy:" + listing.id).row();
      }
      await ctx.reply(
        "⚽ <b>بازیکنان قابل خرید</b>\n" + data.playerListings.slice(0, 8).map((listing) =>
          escapeHtml(listing.player.firstName + " " + listing.player.lastName) + " · قدرت " + listing.player.overall + " · " + cash(listing.askingPrice) + " کش · فروشنده: " + escapeHtml(listing.sellerClub.name)
        ).join("\n"),
        { parse_mode: "HTML", reply_markup: marketKeyboard },
      );
    }
    if (data.packOffers.length) {
      const packs = new InlineKeyboard();
      for (const pack of data.packOffers) packs.text("✨ " + pack.rarity + " · " + cash(pack.priceGold) + " طلا", "pack:buy:" + pack.method).row();
      await ctx.reply("✨ <b>بسته‌های بازیکن ویژه</b>\nبرای جذب بازیکن ویژه بسته موردنظر را انتخاب کن.", { parse_mode: "HTML", reply_markup: packs });
    }
  } catch (error) { await ctx.reply(`دریافت فروشگاه ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("buyitem", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return ctx.reply("خرید آیتم فقط در گفت‌وگوی خصوصی انجام می‌شود.");
  const [itemKey, rawQuantity] = String(ctx.match ?? "").trim().split(/\\s+/);
  if (!itemKey) return ctx.reply("روش استفاده: /buyitem ITEM_KEY [QUANTITY]");
  const quantity = rawQuantity ? Number(rawQuantity) : 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return ctx.reply("تعداد باید بین ۱ تا ۱۰ باشد.");
  try {
    const data = await api<{ purchase: { itemKey: string; quantity: number; balance: string; inventory: number; replayed: boolean } }>("/v1/store/purchase", ctx.from.id, "POST", { itemKey, quantity, idempotencyKey: "tg-store-" + ctx.from.id + "-" + ctx.update.update_id });
    await ctx.reply("خرید انجام شد: " + data.purchase.itemKey + " × " + data.purchase.quantity + "\nموجودی کیف پول: " + cash(data.purchase.balance) + "\nتعداد در انبار: " + data.purchase.inventory);
  } catch (error) { await ctx.reply("خرید ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("inventory", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return ctx.reply("انبار شخصی را در گفت‌وگوی خصوصی باز کنید.");
  try {
    const data = await api<{ inventory: Array<{ itemKey: string; quantity: number }> }>("/v1/store", ctx.from.id);
    if (!data.inventory.length) return ctx.reply("🎒 انبار شما خالی است. از فروشگاه آیتم تهیه کن.", { reply_markup: new InlineKeyboard().text("🛍 رفتن به فروشگاه", "act:store") });
    const keyboard = new InlineKeyboard();
    for (const item of data.inventory) keyboard.text("🧪 استفاده · " + item.itemKey + " × " + item.quantity, "inventory:use:" + item.itemKey).row();
    await ctx.reply("🎒 <b>انبار آیتم‌های باشگاه</b>\n\n" + data.inventory.map((item) => "• " + escapeHtml(item.itemKey) + " × <b>" + item.quantity + "</b>").join("\n")
      + "\n\nبرای استفاده، آیتم را انتخاب کن؛ سپس بازیکن موردنظر را بزن.", { parse_mode: "HTML", reply_markup: keyboard });
  } catch (error) { await ctx.reply("دریافت انبار ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("useitem", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return ctx.reply("استفاده از آیتم فقط در گفت‌وگوی خصوصی انجام می‌شود.");
  const [itemKey, playerId] = String(ctx.match ?? "").trim().split(/\\s+/);
  if (!itemKey || !playerId) return ctx.reply("روش استفاده: /useitem ITEM_KEY PLAYER_ID");
  try {
    const data = await api<{ usage: { itemKey: string; inventory: number; player?: { fitness: number; morale: number } } }>("/v1/store/use", ctx.from.id, "POST", { itemKey, playerId, idempotencyKey: "tg-use-" + ctx.from.id + "-" + ctx.update.update_id });
    await ctx.reply("آیتم استفاده شد. آمادگی: " + (data.usage.player?.fitness ?? "—") + " · روحیه: " + (data.usage.player?.morale ?? "—") + " · باقی‌مانده: " + data.usage.inventory);
  } catch (error) { await ctx.reply("استفاده از آیتم ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("wallet", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای مشاهده موجودی، دستور /wallet را در گفت‌وگوی خصوصی اجرا کنید.");
  try {
    const result = await api<{ wallets: Array<{ asset: "CASH" | "GOLD" | "HONOR"; balance: string }> }>("/v1/wallet", ctx.from.id);
    const balances = result.wallets.map((wallet) => `${wallet.asset === "CASH" ? "کش" : wallet.asset === "GOLD" ? "طلا" : "افتخار"}: ${cash(wallet.balance)}`).join("\n");
    await ctx.reply(`کیف پول باشگاه:\n${balances || "موجودی‌ای ثبت نشده است."}`);
  } catch (error) {
    await ctx.reply(`دریافت کیف پول ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`);
  }
});

bot.command("rename", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای تغییر نام باشگاه، دستور /rename را در گفت‌وگوی خصوصی اجرا کنید.");
  const name = String(ctx.match ?? "").trim();
  if (name.length < 2 || name.length > 32) return ctx.reply("روش استفاده: /rename نام جدید (۲ تا ۳۲ نویسه)");
  try {
    const result = await api<{ club: { name: string } }>("/v1/club", ctx.from.id, "PATCH", { name });
    await ctx.reply(`نام باشگاه با موفقیت به «${result.club.name}» تغییر کرد.`);
  } catch (error) {
    await ctx.reply(`تغییر نام باشگاه ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`);
  }
});

bot.command("players", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای مشاهده بازیکنان، دستور /players را در گفت‌وگوی خصوصی اجرا کنید.");
  try {
    await api("/v1/club/development", ctx.from.id);
    const result = await api<{ players: ApiPlayer[] }>("/v1/club/players", ctx.from.id);
    if (!result.players.length) return ctx.reply("فهرست بازیکنان خالی است. برای تکمیل ترکیب باشگاه، مینی‌اپ را باز کنید.");
    const lines = result.players.map((player, index) => {
      const status = player.status === "INJURED" ? "🩹 مصدوم" : player.status === "SUSPENDED" ? "⛔ محروم" : "🟢 فعال";
      const rich = `<b>${index + 1}. ${escapeHtml(playerName(player))}</b> <code>${escapeHtml(player.position)}</code>\nقدرت: <b>${player.overall}</b> · پتانسیل: ${player.potential}${player.lineupSlot ? ` · ترکیب اصلی: #${player.lineupSlot}` : ""}\nآمادگی: ${player.fitness ?? "—"} · روحیه: ${player.morale ?? "—"}\nقرارداد: ${player.contractDays ?? "—"} روز · دستمزد: ${player.wage ? cash(player.wage) : "—"} در هفته\nوضعیت: ${status}\nشناسه: <code>${escapeHtml(player.id)}</code>`;
      const plain = `${index + 1}. ${playerName(player)} | ${player.position} | قدرت ${player.overall} | پتانسیل ${player.potential}${player.lineupSlot ? ` | ترکیب اصلی #${player.lineupSlot}` : ""}\nآمادگی ${player.fitness ?? "-"} · روحیه ${player.morale ?? "-"} · قرارداد ${player.contractDays ?? "-"} روز · دستمزد ${player.wage ? cash(player.wage) : "-"} در هفته · ${status}\nشناسه: ${player.id}`;
      return { rich, plain };
    });
    let richChunk = `👥 <b>فهرست بازیکنان باشگاه</b> · ${result.players.length} بازیکن\n\n`;
    let plainChunk = `👥 فهرست بازیکنان باشگاه · ${result.players.length} بازیکن\n\n`;
    for (const line of lines) {
      if (richChunk.length + line.rich.length + 2 > 3800) {
        await replyRich(ctx, richChunk, plainChunk);
        richChunk = ""; plainChunk = "";
      }
      richChunk += line.rich + "\n\n";
      plainChunk += line.plain + "\n\n";
    }
    if (richChunk) await replyRich(ctx, richChunk, plainChunk);
  } catch (error) { await ctx.reply(`دریافت فهرست بازیکنان ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("lineup", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای مشاهده ترکیب اصلی، دستور /lineup را در گفت‌وگوی خصوصی اجرا کنید.");
  try {
    await api("/v1/club/development", ctx.from.id);
    const result = await api<{ club: {
      formation: string;
      tactics: { mentality: string; pressing: string; tempo: string; passingStyle: string };
      lineupVersion: number;
      players: Array<{ id: string; firstName: string; lastName: string; position: string; overall: number; lineupSlot: number }>;
    } }>("/v1/club/lineup", ctx.from.id);
    const players = result.club.players.map((player) => `${player.lineupSlot}. ${player.firstName} ${player.lastName} — ${player.position} · قدرت ${player.overall}`);
    const plain = `⚽ ترکیب اصلی · ${result.club.formation} · نسخه ${result.club.lineupVersion}\nذهنیت: ${result.club.tactics.mentality} · پرس: ${result.club.tactics.pressing}\nسرعت: ${result.club.tactics.tempo} · پاس: ${result.club.tactics.passingStyle}\n\n${players.join("\n") || "ترکیب اصلی هنوز تنظیم نشده است."}\n\nبرای مشاهده شناسه بازیکنان از /players و برای ثبت ترکیب از /setlineup استفاده کنید.`;
    const richPlayers = result.club.players.map((player) => `<b>${player.lineupSlot}. ${escapeHtml(player.firstName + " " + player.lastName)}</b> · ${escapeHtml(player.position)} · قدرت <b>${player.overall}</b>`).join("\n");
    const rich = `⚽ <b>ترکیب اصلی · ${escapeHtml(result.club.formation)}</b> · نسخه ${result.club.lineupVersion}\nذهنیت: <b>${escapeHtml(result.club.tactics.mentality)}</b> · پرس: ${escapeHtml(result.club.tactics.pressing)}\nسرعت: ${escapeHtml(result.club.tactics.tempo)} · پاس: ${escapeHtml(result.club.tactics.passingStyle)}\n\n${richPlayers || "ترکیب اصلی هنوز تنظیم نشده است."}\n\nبرای ثبت ترکیب: /setlineup`;
    await replyRich(ctx, rich, plain);
  } catch (error) {
    await ctx.reply(`دریافت ترکیب ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`);
  }
});

bot.command("setlineup", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای تغییر ترکیب اصلی، این بخش را در گفت‌وگوی خصوصی باز کنید.");
  const parts = String(ctx.match ?? "").trim().split(/\\s+/).filter(Boolean);
  if (parts.length) {
    const [formation, ...playerIds] = parts;
    if (!formation || playerIds.length !== 11) {
      return ctx.reply("روش قدیمی همچنان فعال است: /setlineup 4-3-3 PLAYER_ID_1 ... PLAYER_ID_11");
    }
    try {
      const current = await api<{ club: { lineupVersion: number } }>("/v1/club/lineup", ctx.from.id);
      await api("/v1/club/lineup", ctx.from.id, "PUT", { formation, playerIds, expectedVersion: current.club.lineupVersion });
      return ctx.reply("ترکیب اصلی و آرایش ذخیره شد. برای مشاهده نتیجه از /lineup استفاده کنید.");
    } catch (error) {
      return ctx.reply("ذخیره ترکیب ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
    }
  }
  try {
    const [current, roster] = await Promise.all([
      api<{ club: { lineupVersion: number } }>("/v1/club/lineup", ctx.from.id),
      api<{ club: { players: Array<{ id: string; firstName: string; lastName: string; position: string; overall: number; status: string }> } }>("/v1/club/development", ctx.from.id),
    ]);
    const players = roster.club.players.filter((player) => player.status === "ACTIVE");
    if (players.length < 11) return ctx.reply("برای ثبت ترکیب حداقل ۱۱ بازیکن فعال لازم است.");
    pendingLineupSelections.set(ctx.from.id, { formation: "4-3-3", playerIds: [], lineupVersion: current.club.lineupVersion, players });
    const keyboard = new InlineKeyboard()
      .text("4-3-3", "lineup:formation:4-3-3").text("4-4-2", "lineup:formation:4-4-2").row()
      .text("3-5-2", "lineup:formation:3-5-2").text("4-2-3-1", "lineup:formation:4-2-3-1").row()
      .text("لغو", "lineup:cancel");
    await ctx.reply("🧩 <b>تنظیم ترکیب اصلی</b>\nابتدا آرایش تیم را انتخاب کن؛ سپس ۱۱ بازیکن را با دکمه انتخاب می‌کنی.", { parse_mode: "HTML", reply_markup: keyboard });
  } catch (error) {
    await ctx.reply("دریافت اطلاعات ترکیب ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.callbackQuery(/^lineup:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "تنظیم ترکیب فقط در گفت‌وگوی خصوصی مجاز است." });
  const state = pendingLineupSelections.get(ctx.from.id);
  if (!state) return ctx.answerCallbackQuery({ text: "این فرایند منقضی شده است؛ دوباره تنظیم ترکیب را باز کن." });
  const [, action, value] = ctx.callbackQuery.data.split(":");
  if (action === "cancel") {
    pendingLineupSelections.delete(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "فرایند لغو شد." });
    await ctx.editMessageText("تنظیم ترکیب لغو شد.");
    return;
  }
  if (action === "formation") {
    if (!["4-3-3", "4-4-2", "3-5-2", "4-2-3-1"].includes(value ?? "")) return ctx.answerCallbackQuery({ text: "آرایش معتبر نیست." });
    state.formation = value!;
    state.playerIds = [];
  } else if (action === "player") {
    const player = state.players.find((item) => item.id === value);
    if (!player) return ctx.answerCallbackQuery({ text: "بازیکن معتبر نیست." });
    if (state.playerIds.includes(player.id)) return ctx.answerCallbackQuery({ text: "این بازیکن قبلاً انتخاب شده است." });
    if (state.playerIds.length >= 11) return ctx.answerCallbackQuery({ text: "ترکیب ۱۱ بازیکن دارد." });
    state.playerIds.push(player.id);
  } else if (action === "undo") {
    state.playerIds.pop();
  } else if (action === "save") {
    if (state.playerIds.length !== 11) return ctx.answerCallbackQuery({ text: "ابتدا ۱۱ بازیکن انتخاب کن." });
    try {
      await api("/v1/club/lineup", ctx.from.id, "PUT", { formation: state.formation, playerIds: state.playerIds, expectedVersion: state.lineupVersion });
      pendingLineupSelections.delete(ctx.from.id);
      await ctx.answerCallbackQuery({ text: "ترکیب ذخیره شد." });
      await ctx.editMessageText("✅ ترکیب " + state.formation + " با ۱۱ بازیکن ذخیره شد. برای مشاهده /lineup را باز کن.");
      return;
    } catch (error) {
      await ctx.answerCallbackQuery({ text: "ذخیره ترکیب ناموفق بود." });
      await ctx.reply("سرور ترکیب را نپذیرفت: " + (error instanceof Error ? error.message : "خطای نامشخص") + "\nانتخاب‌ها را بررسی کن و دوباره تلاش کن.");
      return;
    }
  } else {
    return ctx.answerCallbackQuery({ text: "گزینه معتبر نیست." });
  }
  const selected = new Set(state.playerIds);
  const keyboard = new InlineKeyboard();
  for (const player of state.players.filter((item) => !selected.has(item.id))) {
    keyboard.text((player.firstName + " " + player.lastName).slice(0, 28) + " · " + player.position + " · " + player.overall, "lineup:player:" + player.id).row();
  }
  if (state.playerIds.length) keyboard.text("↩️ حذف آخرین انتخاب", "lineup:undo");
  if (state.playerIds.length === 11) keyboard.text("✅ ذخیره ترکیب", "lineup:save");
  keyboard.row().text("لغو", "lineup:cancel");
  const picked = state.players.filter((item) => selected.has(item.id)).map((item, index) => (index + 1) + ". " + item.firstName + " " + item.lastName).join("\\n");
  await ctx.answerCallbackQuery({ text: action === "formation" ? "آرایش انتخاب شد." : "انتخاب ثبت شد." });
  await ctx.editMessageText("🧩 <b>آرایش " + state.formation + "</b>\nبازیکنان انتخاب‌شده: " + state.playerIds.length + "/11\n" + (picked || "هنوز بازیکنی انتخاب نشده است.") + "\n\nبازیکن بعدی را انتخاب کن:", { parse_mode: "HTML", reply_markup: keyboard });
});
bot.command("development", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای مشاهده وضعیت توسعه، دستور /development را در گفت‌وگوی خصوصی اجرا کنید.");
  try {
    const result = await api<{ club: {
      trainingGroundLevel: number;
      weeklyWageBill: string;
      wageArrears: string;
      coach: { name: string; level: number; trainingSkill: number; recoverySkill: number; medicalSkill: number; weeklySalary: string };
      players: Array<{ id: string; firstName: string; lastName: string; overall: number; potential: number; age: number; fitness: number; morale: number; contractDays: number; status: string; minimumWeeklyWage: string; maximumWeeklyWage: string }>;
    } }>("/v1/club/development", ctx.from.id);
    const lines = result.club.players.slice(0, 15).map((p) =>
      `• ${p.firstName} ${p.lastName} · قدرت ${p.overall}/${p.potential} · سن ${p.age}\n  آمادگی ${p.fitness} · روحیه ${p.morale} · قرارداد ${p.contractDays} روز · وضعیت ${p.status}\n  تمدید: ${cash(p.minimumWeeklyWage)} تا ${cash(p.maximumWeeklyWage)} کش در هفته\n  شناسه: ${p.id}`,
    );
    const keyboard = new InlineKeyboard();
    for (const player of result.club.players.filter((item) => item.status === "ACTIVE").slice(0, 12)) {
      const label = (player.firstName + " " + player.lastName).slice(0, 18);
      keyboard.text("🏋️ " + label, "player:train:" + player.id).text("📝 تمدید", "player:renew:" + player.id).row();
    }
    await ctx.reply(
      `توسعه بازیکنان · زمین تمرین سطح ${result.club.trainingGroundLevel}\nهزینه دستمزد هفتگی: ${cash(result.club.weeklyWageBill)} کش · معوقات: ${cash(result.club.wageArrears)} کش\nمربی: ${result.club.coach.name} (سطح ${result.club.coach.level})\nتمرین ${result.club.coach.trainingSkill} · ریکاوری ${result.club.coach.recoverySkill} · پزشکی ${result.club.coach.medicalSkill} · دستمزد ${cash(result.club.coach.weeklySalary)} کش در هفته\n\n` +
      (lines.join("\n\n") || "بازیکنی پیدا نشد.") +
      "\n\nبرای هر بازیکن، دکمه تمرین یا تمدید را انتخاب کن.",
      { reply_markup: keyboard },
    );
  } catch (error) { await ctx.reply(`دریافت وضعیت توسعه بازیکنان ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.callbackQuery(/^player:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "مدیریت بازیکن فقط در گفت‌وگوی خصوصی مجاز است." });
  const [, action, value] = ctx.callbackQuery.data.split(":");
  try {
    if (action === "train") {
      const playerId = value;
      if (!playerId) return ctx.answerCallbackQuery({ text: "بازیکن معتبر نیست." });
      pendingTrainingSelections.set(ctx.from.id, { playerId });
      const keyboard = new InlineKeyboard()
        .text("متعادل", "player:focus:BALANCED").text("دروازه‌بانی", "player:focus:GOALKEEPING").row()
        .text("دفاع", "player:focus:DEFENDING").text("پاس", "player:focus:PASSING").row()
        .text("بازی‌سازی", "player:focus:PLAYMAKING").text("دریبل", "player:focus:DRIBBLING").row()
        .text("شوت", "player:focus:SHOOTING").text("بدنسازی", "player:focus:PHYSICAL");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("تمرکز تمرین را انتخاب کن:", { reply_markup: keyboard });
      return;
    }
    if (action === "focus") {
      const state = pendingTrainingSelections.get(ctx.from.id);
      const focuses = ["BALANCED","GOALKEEPING","DEFENDING","PASSING","PLAYMAKING","DRIBBLING","SHOOTING","PHYSICAL"];
      if (!state || !focuses.includes(value ?? "")) return ctx.answerCallbackQuery({ text: "فرایند تمرین منقضی شده است." });
      state.focus = value;
      const keyboard = new InlineKeyboard().text("سبک", "player:intensity:LIGHT").text("معمولی", "player:intensity:NORMAL").text("سنگین", "player:intensity:INTENSE");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("شدت تمرین را انتخاب کن:", { reply_markup: keyboard });
      return;
    }
    if (action === "intensity") {
      const state = pendingTrainingSelections.get(ctx.from.id);
      if (!state?.focus || !["LIGHT","NORMAL","INTENSE"].includes(value ?? "")) return ctx.answerCallbackQuery({ text: "فرایند تمرین معتبر نیست." });
      const result = await api<{ training: { overallBefore: number; overallAfter: number; fitnessBefore: number; fitnessAfter: number; injuryOccurred: boolean; injuryUntil: string | null; cashCost: string; replayed: boolean } }>(
        "/v1/club/players/" + encodeURIComponent(state.playerId) + "/train", ctx.from.id, "POST",
        { focus: state.focus, intensity: value, idempotencyKey: "tg-train-" + ctx.from.id + "-" + ctx.callbackQuery.id },
      );
      pendingTrainingSelections.delete(ctx.from.id);
      const t = result.training;
      await ctx.answerCallbackQuery({ text: "تمرین انجام شد." });
      await ctx.editMessageText("🏋️ تمرین پایان یافت. قدرت: " + t.overallBefore + " ← " + t.overallAfter + " · آمادگی: " + t.fitnessBefore + " ← " + t.fitnessAfter + " · هزینه: " + cash(t.cashCost) + " کش." + (t.injuryOccurred ? "\nمصدومیت تا " + t.injuryUntil : ""));
      return;
    }
    if (action === "renew") {
      const playerId = value;
      if (!playerId) return ctx.answerCallbackQuery({ text: "بازیکن معتبر نیست." });
      const data = await api<{ club: { players: Array<{ id: string; minimumWeeklyWage: string; maximumWeeklyWage: string }> } }>("/v1/club/development", ctx.from.id);
      const player = data.club.players.find((item) => item.id === playerId);
      if (!player) return ctx.answerCallbackQuery({ text: "بازیکن پیدا نشد." });
      pendingContractSelections.set(ctx.from.id, { playerId, minWage: player.minimumWeeklyWage, maxWage: player.maximumWeeklyWage });
      const keyboard = new InlineKeyboard().text("۹۰ روز", "player:contract-days:90").text("۱۸۰ روز", "player:contract-days:180").text("۳۶۵ روز", "player:contract-days:365");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("مدت تمدید قرارداد را انتخاب کن:", { reply_markup: keyboard });
      return;
    }
    if (action === "contract-days") {
      const state = pendingContractSelections.get(ctx.from.id);
      const days = Number(value);
      if (!state || ![90,180,365].includes(days)) return ctx.answerCallbackQuery({ text: "فرایند تمدید منقضی شده است." });
      state.days = days;
      const min = BigInt(state.minWage), max = BigInt(state.maxWage);
      const wages = [...new Set([min.toString(), ((min + max) / 2n).toString(), max.toString()])];
      const keyboard = new InlineKeyboard();
      for (const wage of wages) keyboard.text(cash(wage) + " کش/هفته", "player:contract-wage:" + wage).row();
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("دستمزد هفتگی جدید را انتخاب کن:", { reply_markup: keyboard });
      return;
    }
    if (action === "contract-wage") {
      const state = pendingContractSelections.get(ctx.from.id);
      if (!state?.days || !value || !/^[1-9][0-9]{0,8}$/.test(value)) return ctx.answerCallbackQuery({ text: "فرایند تمدید معتبر نیست." });
      const result = await api<{ contract: { contractDays: number; weeklyWage: string; replayed: boolean } }>(
        "/v1/club/players/" + encodeURIComponent(state.playerId) + "/contract/renew", ctx.from.id, "POST",
        { extensionDays: state.days, weeklyWage: value, idempotencyKey: "tg-renew-" + ctx.from.id + "-" + ctx.callbackQuery.id },
      );
      pendingContractSelections.delete(ctx.from.id);
      await ctx.answerCallbackQuery({ text: "قرارداد تمدید شد." });
      await ctx.editMessageText("✅ قرارداد تمدید شد: " + result.contract.contractDays + " روز باقی‌مانده · دستمزد هفتگی " + cash(result.contract.weeklyWage) + " کش.");
      return;
    }
    await ctx.answerCallbackQuery({ text: "گزینه معتبر نیست." });
  } catch (error) {
    pendingTrainingSelections.delete(ctx.from.id);
    pendingContractSelections.delete(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "عملیات ناموفق بود.", show_alert: true });
    await ctx.reply("عملیات بازیکن ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("train", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /train را در گفت‌وگوی خصوصی اجرا کنید.");
  const [playerId, focusRaw, intensityRaw] = String(ctx.match ?? "").trim().split(/\s+/);
  const focus = focusRaw?.toUpperCase();
  const intensity = intensityRaw?.toUpperCase();
  const focuses = ["BALANCED", "GOALKEEPING", "DEFENDING", "PASSING", "PLAYMAKING", "DRIBBLING", "SHOOTING", "PHYSICAL"];
  if (!playerId || !focus || !focuses.includes(focus) || !["LIGHT", "NORMAL", "INTENSE"].includes(intensity ?? "")) {
    return ctx.reply("روش استفاده: /train PLAYER_ID FOCUS INTENSITY\nتمرکز: BALANCED، GOALKEEPING، DEFENDING، PASSING، PLAYMAKING، DRIBBLING، SHOOTING، PHYSICAL\nشدت: LIGHT، NORMAL، INTENSE");
  }
  try {
    const result = await api<{ training: { overallBefore: number; overallAfter: number; fitnessBefore: number; fitnessAfter: number; injuryOccurred: boolean; injuryUntil: string | null; cashCost: string; replayed: boolean } }>(
      `/v1/club/players/${encodeURIComponent(playerId)}/train`, ctx.from.id, "POST",
      { focus, intensity, idempotencyKey: `tg-train-${ctx.from.id}-${ctx.update.update_id}` },
    );
    const t = result.training;
    await ctx.reply(
      `تمرین پایان یافت. قدرت از ${t.overallBefore} به ${t.overallAfter} رسید · آمادگی از ${t.fitnessBefore} به ${t.fitnessAfter} تغییر کرد · هزینه: ${cash(t.cashCost)} کش.` +
      (t.injuryOccurred ? `\nمصدومیت: بازیکن تا ${t.injuryUntil} در دسترس نیست.` : "") +
      (t.replayed ? "\nاین درخواست قبلاً ثبت شده بود." : ""),
    );
  } catch (error) { await ctx.reply(`تمرین ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("renew", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /renew را در گفت‌وگوی خصوصی اجرا کنید.");
  const [playerId, daysRaw, wageRaw] = String(ctx.match ?? "").trim().split(/\s+/);
  const days = Number(daysRaw);
  if (!playerId || ![90, 180, 365].includes(days) || !wageRaw || !/^[1-9][0-9]{0,8}$/.test(wageRaw)) {
    return ctx.reply("روش استفاده: /renew PLAYER_ID 90|180|365 WEEKLY_WAGE\nحداقل دستمزد هفتگی قابل قبول را در /development ببینید.");
  }
  try {
    const result = await api<{ contract: { contractDays: number; weeklyWage: string; replayed: boolean } }>(
      `/v1/club/players/${encodeURIComponent(playerId)}/contract/renew`, ctx.from.id, "POST",
      { extensionDays: days, weeklyWage: wageRaw, idempotencyKey: `tg-renew-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(`قرارداد تمدید شد: ${result.contract.contractDays} روز باقی‌مانده · دستمزد هفتگی ${cash(result.contract.weeklyWage)} کش.${result.contract.replayed ? " این درخواست قبلاً ثبت شده بود." : ""}`);
  } catch (error) { await ctx.reply(`تمدید قرارداد ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("operations", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /operations را در گفت‌وگوی خصوصی اجرا کنید.");
  try {
    const result = await api<{ club: {
      stadiumLevel: number; stadiumCapacity: number; ticketPrice: string; trainingGroundLevel: number; academyLevel: number;
      dailyMaintenance: string; operatingArrears: string; coach: { name: string; level: number; weeklySalary: string } | null;
      activeSponsor: { partnerName: string; tier: string; dailyIncome: string; endsAt: string } | null;
      sponsorOffers: Array<{ id: string; partnerName: string; tier: string; dailyIncome: string; signingBonus: string; durationDays: number }>;
      coachOffers: Array<{ id: string; name: string; signingFee: string; weeklySalary: string }>;
      prospects: Array<{ id: string; firstName: string; lastName: string; age: number; position: string; overall: number; potential: number; recruitmentCost: string }>;
      financeEntries: Array<{ category: string; direction: string; amount: string; description: string }>;
    } }>("/v1/club/operations", ctx.from.id);
    const club = result.club;
    const prospects = club.prospects.map((p) => `• ${p.firstName} ${p.lastName} · ${p.age}y · ${p.position} · OVR ${p.overall}/POT ${p.potential} · ${cash(p.recruitmentCost)} Cash\n  ID: ${p.id}`);
    const sponsor = club.activeSponsor ? `${club.activeSponsor.partnerName} · ${club.activeSponsor.tier} · ${cash(club.activeSponsor.dailyIncome)} Cash/day` : "No active sponsor";
    const keyboard = new InlineKeyboard()
      .text("ارتقای ورزشگاه", "clubop:upgrade:STADIUM").text("ارتقای زمین تمرین", "clubop:upgrade:TRAINING_GROUND").row()
      .text("ارتقای آکادمی", "clubop:upgrade:ACADEMY").text("🔎 استعدادیابی", "clubop:scout").row()
      .text("💼 ارتقای مربی", "clubop:coach-upgrade").row()
      .text("بلیت ۵۰", "clubop:ticket:50").text("بلیت ۱۰۰", "clubop:ticket:100").text("بلیت ۲۵۰", "clubop:ticket:250").row();
    for (const prospect of club.prospects.slice(0, 8)) keyboard.text("جذب " + (prospect.firstName + " " + prospect.lastName).slice(0, 18), "clubop:recruit:" + prospect.id).row();
    for (const offer of club.sponsorOffers) keyboard.text("امضای حامی: " + offer.partnerName.slice(0, 20), "clubop:sponsor:" + offer.id).row();
    for (const coachOffer of club.coachOffers) keyboard.text("استخدام مربی: " + coachOffer.name.slice(0, 20), "clubop:coach:" + coachOffer.id).row();
    await ctx.reply(
      `امکانات باشگاه\nورزشگاه سطح ${club.stadiumLevel} · ظرفیت ${club.stadiumCapacity} نفر · بلیت ${cash(club.ticketPrice)} کش\nزمین تمرین سطح ${club.trainingGroundLevel} · آکادمی سطح ${club.academyLevel}\nهزینه نگهداری روزانه: ${cash(club.dailyMaintenance)} کش · معوقات عملیاتی: ${cash(club.operatingArrears)} کش\nمربی: ${club.coach?.name ?? "ندارد"} (سطح ${club.coach?.level ?? 0}) · دستمزد هفتگی ${cash(club.coach?.weeklySalary ?? "0")} کش\nحامی مالی: ${sponsor}\n\nاستعدادهای آکادمی:\n${prospects.join("\n\n") || "استعداد آماده‌ای وجود ندارد."}\n\nبرای هر عملیات، دکمه مربوط را انتخاب کن.`,
      { reply_markup: keyboard },
    );
  } catch (error) { await ctx.reply(`دریافت امکانات باشگاه ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("finance", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /finance را در گفت‌وگوی خصوصی اجرا کنید.");
  const daysRaw = String(ctx.match ?? "").trim();
  const days = daysRaw ? Number(daysRaw) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 90) return ctx.reply("روش استفاده: /finance [DAYS 1-90]");
  try {
    const result = await api<{ periodDays: number; income: string; expenses: string; net: string; operatingArrears: string; entries: Array<{ category: string; direction: string; amount: string; description: string; occurredAt: string }> }>(`/v1/club/finance?days=${days}`, ctx.from.id);
    const entries = result.entries.slice(0, 12).map((entry) =>
      "• " + (entry.direction === "CREDIT" ? "+" : "−") + cash(entry.amount) + " کش · " + entry.category + "\n  " + entry.description + " · " + new Date(entry.occurredAt).toLocaleDateString("fa-IR"),
    );
    const netLabel = result.net.startsWith("-") ? "زیان" : "سود";
    const netAmount = result.net.startsWith("-") ? result.net.slice(1) : result.net;
    await ctx.reply(
      "صورت‌حساب " + result.periodDays + " روز اخیر\nدرآمد: " + cash(result.income) + " Cash\nهزینه: " + cash(result.expenses) + " Cash\n" + netLabel + ": " + cash(netAmount) + " Cash\nمعوقات عملیاتی: " + cash(result.operatingArrears) + " Cash\n\nگردش‌های اخیر:\n" + (entries.join("\n\n") || "No finance entries"),
    );
  } catch (error) { await ctx.reply("دریافت صورت‌حساب مالی ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});
bot.callbackQuery(/^clubop:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "مدیریت باشگاه فقط در گفت‌وگوی خصوصی مجاز است." });
  const [, action, value] = ctx.callbackQuery.data.split(":");
  try {
    if (action === "upgrade" && ["STADIUM","TRAINING_GROUND","ACADEMY"].includes(value ?? "")) {
      const result = await api<{ upgrade: { level?: number; cost?: string; replayed: boolean } }>("/v1/club/facilities/" + value + "/upgrade", ctx.from.id, "POST", { idempotencyKey: "tg-upgrade-" + ctx.from.id + "-" + ctx.callbackQuery.id });
      await ctx.answerCallbackQuery({ text: "ارتقا انجام شد." });
      await ctx.editMessageText("✅ سطح امکان به " + result.upgrade.level + " ارتقا یافت. هزینه: " + cash(result.upgrade.cost ?? "0") + " کش.");
      return;
    }
    if (action === "scout") {
      const result = await api<{ scouting: { prospects: Array<{ id: string; firstName: string; lastName: string; overall: number; potential: number; recruitmentCost: string }>; scoutingCost?: string } }>("/v1/club/academy/scout", ctx.from.id, "POST", { idempotencyKey: "tg-scout-" + ctx.from.id + "-" + ctx.callbackQuery.id });
      const keyboard = new InlineKeyboard();
      for (const player of result.scouting.prospects) keyboard.text("جذب " + (player.firstName + " " + player.lastName).slice(0, 24), "clubop:recruit:" + player.id).row();
      await ctx.answerCallbackQuery({ text: "استعدادیابی انجام شد." });
      await ctx.editMessageText("🔎 استعدادهای جدید شناسایی شدند. هزینه استعدادیابی: " + cash(result.scouting.scoutingCost ?? "0") + " کش.\n" + result.scouting.prospects.map((p) => p.firstName + " " + p.lastName + " · قدرت " + p.overall + " · پتانسیل " + p.potential + " · هزینه جذب " + cash(p.recruitmentCost)).join("\n"), { reply_markup: keyboard });
      return;
    }
    if (action === "recruit" && value) {
      const result = await api<{ recruitment: { player?: { firstName: string; lastName: string; overall: number; potential: number }; cost?: string; replayed: boolean } }>("/v1/club/academy/" + encodeURIComponent(value) + "/recruit", ctx.from.id, "POST", { idempotencyKey: "tg-recruit-" + ctx.from.id + "-" + ctx.callbackQuery.id });
      await ctx.answerCallbackQuery({ text: "بازیکن جذب شد." });
      await ctx.reply(result.recruitment.replayed ? "این جذب قبلاً ثبت شده بود." : "✅ " + result.recruitment.player?.firstName + " " + result.recruitment.player?.lastName + " جذب شد · قدرت " + result.recruitment.player?.overall + " · پتانسیل " + result.recruitment.player?.potential + " · هزینه " + cash(result.recruitment.cost ?? "0") + " کش.");
      return;
    }
    if (action === "sponsor" && value) {
      const result = await api<{ contract: { sponsor?: { partnerName: string; dailyIncome: string }; replayed: boolean } }>("/v1/club/sponsors/sign", ctx.from.id, "POST", { offerId: value, idempotencyKey: "tg-sponsor-" + ctx.from.id + "-" + ctx.callbackQuery.id });
      await ctx.answerCallbackQuery({ text: "قرارداد حامی مالی ثبت شد." });
      await ctx.reply("🤝 قرارداد با " + result.contract.sponsor?.partnerName + " امضا شد. درآمد روزانه: " + cash(result.contract.sponsor?.dailyIncome ?? "0") + " کش.");
      return;
    }
    if (action === "coach" && value) {
      const result = await api<{ hiring: { coach?: { name: string; weeklySalary: string }; signingFee?: string; replayed: boolean } }>("/v1/club/coach/hire", ctx.from.id, "POST", { candidateId: value, idempotencyKey: "tg-coach-hire-" + ctx.from.id + "-" + ctx.callbackQuery.id });
      await ctx.answerCallbackQuery({ text: "مربی استخدام شد." });
      await ctx.reply("✅ مربی " + result.hiring.coach?.name + " استخدام شد · حق امضا " + cash(result.hiring.signingFee ?? "0") + " کش · دستمزد هفتگی " + cash(result.hiring.coach?.weeklySalary ?? "0") + " کش.");
      return;
    }
    if (action === "coach-upgrade") {
      const result = await api<{ upgrade: { coach?: { level: number }; cost?: string } }>("/v1/club/coach/upgrade", ctx.from.id, "POST", { idempotencyKey: "tg-coach-upgrade-" + ctx.from.id + "-" + ctx.callbackQuery.id });
      await ctx.answerCallbackQuery({ text: "مربی ارتقا یافت." });
      await ctx.reply("مربی به سطح " + result.upgrade.coach?.level + " ارتقا یافت. هزینه: " + cash(result.upgrade.cost ?? "0") + " کش.");
      return;
    }
    if (action === "ticket" && value && /^(50|100|250)$/.test(value)) {
      const current = await api<{ club: { ticketPrice: string } }>("/v1/club/operations", ctx.from.id);
      const result = await api<{ ticketing: { ticketPrice: string } }>("/v1/club/stadium/ticket-price", ctx.from.id, "PATCH", { ticketPrice: value, expectedTicketPrice: current.club.ticketPrice });
      await ctx.answerCallbackQuery({ text: "قیمت بلیت تغییر کرد." });
      await ctx.reply("قیمت بلیت روی " + cash(result.ticketing.ticketPrice) + " کش تنظیم شد.");
      return;
    }
    await ctx.answerCallbackQuery({ text: "گزینه معتبر نیست." });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "عملیات ناموفق بود.", show_alert: true });
    await ctx.reply("عملیات باشگاه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("upgrade", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /upgrade را در گفت‌وگوی خصوصی اجرا کنید.");
  const facility = String(ctx.match ?? "").trim().toLowerCase();
  const value = ({ stadium: "STADIUM", training: "TRAINING_GROUND", academy: "ACADEMY" } as const)[facility as "stadium" | "training" | "academy"];
  if (!value) return ctx.reply("روش استفاده: /upgrade stadium|training|academy");
  try {
    const result = await api<{ upgrade: { level?: number; cost?: string; replayed: boolean } }>(
      `/v1/club/facilities/${value}/upgrade`, ctx.from.id, "POST",
      { idempotencyKey: `tg-upgrade-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.upgrade.replayed ? "این درخواست ارتقا قبلاً پردازش شده است." : `${({stadium:"ورزشگاه",training:"زمین تمرین",academy:"آکادمی"} as Record<string,string>)[facility]} به سطح ${result.upgrade.level} ارتقا یافت. هزینه: ${cash(result.upgrade.cost ?? "0")} کش.`);
  } catch (error) { await ctx.reply(`ارتقای امکانات ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("ticket-price", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /ticket-price را در گفت‌وگوی خصوصی اجرا کنید.");
  const price = String(ctx.match ?? "").trim();
  if (!/^(?:[1-9][0-9]?|[1-4][0-9]{2}|500)$/.test(price) || Number(price) < 10) {
    return ctx.reply("روش استفاده: /ticket-price 10-500");
  }
  try {
    const current = await api<{ club: { ticketPrice: string } }>("/v1/club/operations", ctx.from.id);
    const result = await api<{ ticketing: { ticketPrice: string } }>(
      "/v1/club/stadium/ticket-price", ctx.from.id, "PATCH",
      { ticketPrice: price, expectedTicketPrice: current.club.ticketPrice },
    );
    await ctx.reply(`قیمت بلیت ورزشگاه روی ${cash(result.ticketing.ticketPrice)} کش تنظیم شد.`);
  } catch (error) { await ctx.reply(`تغییر قیمت بلیت ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("scout", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /scout را در گفت‌وگوی خصوصی اجرا کنید.");
  try {
    const result = await api<{ scouting: { prospects: Array<{ id: string; firstName: string; lastName: string; age: number; position: string; overall: number; potential: number; recruitmentCost: string }>; scoutingCost?: string; replayed: boolean } }>(
      "/v1/club/academy/scout", ctx.from.id, "POST",
      { idempotencyKey: `tg-scout-${ctx.from.id}-${ctx.update.update_id}` },
    );
    if (result.scouting.replayed) return ctx.reply("این درخواست استعدادیابی قبلاً پردازش شده است.");
    const lines = result.scouting.prospects.map((p) => `• ${p.firstName} ${p.lastName} · سن ${p.age} · ${p.position} · قدرت ${p.overall}/پتانسیل ${p.potential}\n  هزینه جذب ${cash(p.recruitmentCost)} کش · شناسه ${p.id}`);
    await ctx.reply(`استعدادیابی انجام شد. هزینه: ${cash(result.scouting.scoutingCost ?? "0")} کش\n\n${lines.join("\n\n")}\n\nبرای جذب: /recruit PROSPECT_ID`);
  } catch (error) { await ctx.reply(`استعدادیابی آکادمی ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("recruit", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /recruit را در گفت‌وگوی خصوصی ربات اجرا کنید.");
  const prospectId = String(ctx.match ?? "").trim();
  if (!prospectId) return ctx.reply("روش استفاده: /recruit PROSPECT_ID");
  try {
    const result = await api<{ recruitment: { player?: { firstName: string; lastName: string; overall: number; potential: number }; cost?: string; replayed: boolean } }>(
      `/v1/club/academy/${encodeURIComponent(prospectId)}/recruit`, ctx.from.id, "POST",
      { idempotencyKey: `tg-recruit-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.recruitment.replayed ? "این درخواست جذب قبلاً پردازش شده است." : `بازیکن ${result.recruitment.player?.firstName} ${result.recruitment.player?.lastName} جذب شد · قدرت ${result.recruitment.player?.overall} · پتانسیل ${result.recruitment.player?.potential} · هزینه ${cash(result.recruitment.cost ?? "0")} کش.`);
  } catch (error) { await ctx.reply(`جذب بازیکن ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("sponsor", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /sponsor را در گفت‌وگوی خصوصی ربات اجرا کنید.");
  const offerId = String(ctx.match ?? "").trim().toLowerCase();
  if (!["local-partner", "regional-brand", "national-network"].includes(offerId)) {
    try {
      const overview = await api<{ club: { sponsorOffers: Array<{ id: string; partnerName: string; tier: string; dailyIncome: string; signingBonus: string; durationDays: number }> } }>("/v1/club/operations", ctx.from.id);
      const offers = overview.club.sponsorOffers.map((offer) => "• " + offer.id + " · " + offer.partnerName + " (" + offer.tier + ") · " + cash(offer.dailyIncome) + " Cash/day · Bonus " + cash(offer.signingBonus) + " · " + offer.durationDays + " days");
      return ctx.reply("پیشنهادهای حامی مالی:\n" + (offers.join("\n") || "هنوز پیشنهادی فعال نشده است.") + "\n\n/sponsor OFFER_ID");
    } catch (error) { return ctx.reply("دریافت پیشنهادهای حامی مالی ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
  }
  try {
    const result = await api<{ contract: { sponsor?: { partnerName: string; tier: string; dailyIncome: string }; replayed: boolean } }>(
      "/v1/club/sponsors/sign", ctx.from.id, "POST",
      { offerId, idempotencyKey: `tg-sponsor-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.contract.replayed ? "این قرارداد حامی مالی قبلاً ثبت شده است." : `قرارداد با ${result.contract.sponsor?.partnerName} (${result.contract.sponsor?.tier}) امضا شد. درآمد روزانه: ${cash(result.contract.sponsor?.dailyIncome ?? "0")} کش.`);
  } catch (error) { await ctx.reply(`امضای قرارداد حامی مالی ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("coach-upgrade", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /coach-upgrade را در گفت‌وگوی خصوصی ربات اجرا کنید.");
  try {
    const result = await api<{ upgrade: { coach?: { level: number; trainingSkill: number; recoverySkill: number; medicalSkill: number }; cost?: string; replayed: boolean } }>(
      "/v1/club/coach/upgrade", ctx.from.id, "POST",
      { idempotencyKey: `tg-coach-upgrade-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.upgrade.replayed ? "ارتقای مربی قبلاً ثبت شده است." : `مربی به سطح ${result.upgrade.coach?.level} ارتقا یافت. مهارت تمرین ${result.upgrade.coach?.trainingSkill}، ریکاوری ${result.upgrade.coach?.recoverySkill} و پزشکی ${result.upgrade.coach?.medicalSkill}. هزینه: ${cash(result.upgrade.cost ?? "0")} کش.`);
  } catch (error) { await ctx.reply(`ارتقای مربی ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("hire-coach", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("دستور /hire-coach را در گفت‌وگوی خصوصی ربات اجرا کنید.");
  const candidateId = String(ctx.match ?? "").trim().toLowerCase();
  if (!["balanced", "youth", "performance"].includes(candidateId)) {
    try {
      const overview = await api<{ club: { coachOffers: Array<{ id: string; name: string; signingFee: string; weeklySalary: string; trainingSkill: number; recoverySkill: number; medicalSkill: number }> } }>("/v1/club/operations", ctx.from.id);
      const offers = overview.club.coachOffers.map((candidate) => "• " + candidate.id + " · " + candidate.name + " · Fee " + cash(candidate.signingFee) + " · Salary " + cash(candidate.weeklySalary) + "/week · Skills " + candidate.trainingSkill + "/" + candidate.recoverySkill + "/" + candidate.medicalSkill);
      return ctx.reply("مربیان قابل استخدام:\n" + offers.join("\n") + "\n\n/hire-coach balanced|youth|performance");
    } catch (error) { return ctx.reply("دریافت فهرست مربیان ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
  }
  try {
    const result = await api<{ hiring: { coach?: { name: string; weeklySalary: string }; signingFee?: string; replayed: boolean } }>(
      "/v1/club/coach/hire", ctx.from.id, "POST",
      { candidateId, idempotencyKey: `tg-coach-hire-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.hiring.replayed ? "درخواست استخدام این مربی قبلاً پردازش شده است." : `مربی ${result.hiring.coach?.name} استخدام شد. حق امضا: ${cash(result.hiring.signingFee ?? "0")} کش · دستمزد هفتگی: ${cash(result.hiring.coach?.weeklySalary ?? "0")} کش.`);
  } catch (error) { await ctx.reply(`استخدام مربی ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("market", async (ctx) => {
  if (!ctx.from) return;
  try {
    const result = await api<{ listings: ApiListing[] }>("/v1/market/listings", ctx.from.id);
    if (!result.listings.length) return ctx.reply("در حال حاضر آگهی فعالی در بازار نقل‌وانتقالات وجود ندارد.");
    const lines = result.listings.map((item) =>
      `• ${playerName(item.player)} | ${item.player.position} | OVR ${item.player.overall}\n  ${cash(item.askingPrice)} Cash · ${item.sellerClub?.name ?? "Club"}\n  Listing ID: ${item.id}`,
    );
    await ctx.reply("بازار نقل‌وانتقالات:\n\n" + lines.join("\n\n") + "\n\nبرای خرید: /buy LISTING_ID");
  } catch (error) { await ctx.reply(`دریافت بازار ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("specialchallenges", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ challenges: Array<{
      slug: string; title: string; description: string; rewardName: string;
      progress: { matches: number; wins: number; goals: number; requiredMatches: number; requiredWins: number; requiredGoals: number };
      claimed: boolean; available: boolean; canClaim: boolean;
    }> }>("/v1/players/special/challenges", ctx.from.id);
    const keyboard = new InlineKeyboard();
    const lines = result.challenges.map((challenge) => {
      const p = challenge.progress;
      if (challenge.canClaim) keyboard.text("🎁 دریافت " + challenge.rewardName, "legacy:claim:" + challenge.slug).row();
      const status = challenge.claimed ? "✅ دریافت شده"
        : !challenge.available ? "🔒 جایزه کمیاب قبلاً دریافت شده"
        : challenge.canClaim ? "🎉 آماده دریافت" : "⏳ در حال پیشرفت";
      return "<b>" + escapeHtml(challenge.title) + "</b> — " + escapeHtml(challenge.rewardName)
        + "\n" + escapeHtml(challenge.description)
        + "\nپیشرفت: " + p.matches + "/" + p.requiredMatches + " مسابقه · "
        + p.wins + "/" + p.requiredWins + " برد · " + p.goals + "/" + p.requiredGoals + " گل"
        + "\nوضعیت: " + status;
    });
    await replyRich(ctx, "🏅 <b>چالش‌های اسطوره‌ای</b>\n\n" + lines.join("\n\n"),
      "چالش‌های اسطوره‌ای\n" + result.challenges.map((item) => item.title + " — " + item.rewardName).join("\n"),
      keyboard);
  } catch (error) {
    await ctx.reply("دریافت چالش‌های اسطوره‌ای ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("special", async (ctx) => {
  if (!ctx.from) return;
  try {
    const result = await api<{ players: Array<{ fullName: string; rarity: string; overall: number }>; packOffers: Array<{ method: string; rarity: string; priceGold: string }> }>("/v1/players/special", ctx.from.id);
    const offers = result.packOffers.map((offer) => `• ${offer.rarity}: ${offer.priceGold} Gold — /pack ${offer.method.replace("_pack", "")}`);
    const featured = result.players.slice(0, 10).map((player) => `• ${player.fullName} | ${player.rarity} | OVR ${player.overall}`);
    await ctx.reply("بسته‌های جذب بازیکن ویژه:\n" + offers.join("\n") + "\n\nبازیکنان شاخص:\n" + featured.join("\n"));
  } catch (error) { await ctx.reply(`دریافت بازیکنان ویژه ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("pack", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای جذب بازیکن ویژه، دستور /pack را در گفت‌وگوی خصوصی اجرا کنید.");
  const requested = String(ctx.match ?? "").trim().toLowerCase();
  const method = ({ epic: "epic_pack", legendary: "legendary_pack", icon: "icon_pack" } as const)[requested as "epic" | "legendary" | "icon"];
  if (!method) return ctx.reply("روش استفاده: /pack epic|legendary|icon");
  try {
    const result = await api<{ acquisition: { specialPlayer: { fullName: string; rarity: string; overall: number }; goldBalance: string; replayed: boolean } }>("/v1/players/special/acquire", ctx.from.id, "POST", { method, idempotencyKey: `tg-${ctx.from.id}-${ctx.update.update_id}` });
    const item = result.acquisition.specialPlayer;
    await ctx.reply(`بازیکن ویژه ${item.fullName} (${item.rarity}، قدرت ${item.overall}) جذب شد.\nموجودی طلای باقی‌مانده: ${cash(result.acquisition.goldBalance)}${result.acquisition.replayed ? "\nاین درخواست قبلاً ثبت شده بود." : ""}`);
  } catch (error) { await ctx.reply(`جذب بازیکن ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("sell", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای ثبت بازیکن در بازار، دستور /sell را در گفت‌وگوی خصوصی اجرا کنید.");
  const parts = String(ctx.match ?? "").trim().split(/\s+/);
  const [playerId, price] = parts;
  if (!playerId || !price || !/^[1-9][0-9]{0,14}$/.test(price)) {
    return ctx.reply("روش استفاده: /sell PLAYER_ID PRICE\nبرای مشاهده شناسه بازیکنان از /players استفاده کنید.");
  }
  try {
    const result = await api<{ listing: { id: string; askingPrice: string } }>("/v1/market/listings", ctx.from.id, "POST", {
      playerId, askingPrice: price, expiresInHours: 72,
    });
    await ctx.reply(`آگهی فروش ثبت شد. قیمت درخواستی: ${cash(result.listing.askingPrice)} کش\nشناسه آگهی: ${result.listing.id}`);
  } catch (error) { await ctx.reply(`ثبت آگهی فروش ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("buy", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("برای خرید بازیکن، دستور /buy را در گفت‌وگوی خصوصی اجرا کنید.");
  const listingId = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!listingId) return ctx.reply("روش استفاده: /buy LISTING_ID\nبرای مشاهده آگهی‌ها از /market استفاده کنید.");
  try {
    const result = await api<{ purchase: { price: string; replayed: boolean } }>(
      `/v1/market/listings/${encodeURIComponent(listingId)}/buy`, ctx.from.id, "POST",
    );
    await ctx.reply(`خرید بازیکن با موفقیت انجام شد. مبلغ پرداختی: ${cash(result.purchase.price)} کش.${result.purchase.replayed ? " این خرید قبلاً انجام شده بود." : ""}`);
  } catch (error) { await ctx.reply(`تکمیل خرید ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("opponents", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const search = String(ctx.match ?? "").trim();
    const result = await api<{ opponents: Array<{ id: string; name: string; level: number; reputation: number; ownerUsername?: string | null }> }>(
      "/v1/matches/opponents" + (search ? "?q=" + encodeURIComponent(search) : ""), ctx.from.id,
    );
    const keyboard = new InlineKeyboard();
    const lines = result.opponents.slice(0, search ? 25 : 10).map((club) => {
      keyboard.text("⚽ بازی با " + club.name.slice(0, 20), "opp:match:" + club.id)
        .text("⚔️ دعوت", "opp:challenge:" + club.id).row();
      return `<b>${escapeHtml(club.name)}</b> · سطح ${club.level} · اعتبار ${club.reputation}`
        + (club.ownerUsername ? " · @" + escapeHtml(club.ownerUsername) : "");
    });
    await replyRich(
      ctx,
      "👥 <b>" + (search ? "نتایج جست‌وجوی حریف" : "۱۰ باشگاه فعال اخیر") + "</b>\n\n"
        + (lines.join("\n") || "حریف واجد شرایطی پیدا نشد.")
        + "\n\nجست‌وجو با نام باشگاه یا شناسه تلگرام: /opponents QUERY",
      "حریفان آماده مسابقه\n" + result.opponents.map((club) => club.name + " · سطح " + club.level).join("\n")
        + "\nجست‌وجو: /opponents نام باشگاه یا شناسه تلگرام",
      keyboard,
    );
  } catch (error) { await ctx.reply(`دریافت فهرست حریفان ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("friendly", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const opponentClubId = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!opponentClubId) return ctx.reply("روش استفاده: /friendly CLUB_ID\nبرای پیدا کردن حریف از /opponents استفاده کنید.");
  try {
    const result = await api<{ match: { id: string; scheduledAt: string }; replayed: boolean }>("/v1/matches/friendly", ctx.from.id, "POST", {
      opponentClubId, idempotencyKey: `bot-friendly-${ctx.from.id}-${ctx.update.update_id}`,
    });
    await ctx.reply(`مسابقه دوستانه برنامه‌ریزی شد. شناسه: ${result.match.id}\nزمان شروع: ${new Date(result.match.scheduledAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}\nمسابقه به‌صورت خودکار اجرا می‌شود؛ وضعیت را با /matches ببینید.`);
  } catch (error) { await ctx.reply(`زمان‌بندی مسابقه دوستانه ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});


bot.command("challenge", async (ctx) => {
  if (!ctx.from) return;
  try {
    const inGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
    const result = await api<{ challenge: { token: string; expiresAt: string }; asset: string; goldCost: string; shareUrl: string | null }>(
      "/v1/friendly-challenges", ctx.from.id, "POST",
      { idempotencyKey: randomUUID(), ...(inGroup ? { groupTelegramId: String(ctx.chat.id) } : {}) },
    );
    const shareUrl = result.shareUrl ?? (bot.botInfo?.username
      ? "https://t.me/" + bot.botInfo.username + "?start=challenge_" + result.challenge.token : null);
    const message = "⚔️ دعوت اختصاصی چالش دوستانه ساخته شد.\nهزینه: "
      + (result.asset === "FREE" ? "رایگان" : result.asset === "GOLD" ? result.goldCost + " طلا" : "اعتبار خریداری‌شده")
      + "\nاعتبار تا: " + new Date(result.challenge.expiresAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })
      + (shareUrl ? "\n\nلینک اختصاصی: " + shareUrl : "\n\nنام کاربری ربات برای ساخت لینک تنظیم نشده است.");
    const keyboard = new InlineKeyboard();
    if (shareUrl) {
      keyboard.url("📨 اشتراک‌گذاری لینک دعوت", "https://t.me/share/url?url=" + encodeURIComponent(shareUrl)
        + "&text=" + encodeURIComponent("برای مسابقه Football Empire دعوت شدی!"));
      if (inGroup) keyboard.row().text("⚔️ پذیرش چالش در همین گروه", "challenge:accept:" + result.challenge.token);
    }
    await ctx.reply(message, { reply_markup: keyboard });
  } catch (error) {
    await ctx.reply("ایجاد چالش ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("acceptchallenge", async (ctx) => {
  if (!ctx.from) return;
  const tokenValue = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!tokenValue) return ctx.reply("روش استفاده: /acceptchallenge TOKEN");
  try {
    const result = await api<{ match: { id: string; scheduledAt: string } }>(
      `/v1/friendly-challenges/${encodeURIComponent(tokenValue)}/accept`, ctx.from.id, "POST", {},
    );
    await ctx.reply("چالش پذیرفته شد. مسابقه " + result.match.id + " در " + new Date(result.match.scheduledAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }) + " برنامه‌ریزی شد.");
  } catch (error) { await ctx.reply("پذیرش چالش ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("pyramidleagues", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ season: number; tiers: Array<{ tier: number; name: string; waitingTeams: number; leagues: Array<{ id: string; name: string; status: string; teams: number; isMyLeague: boolean }>; myApplication: string | null }>; promotionOffers: Array<{ id: string; targetTier: number; finalPosition: number; season: number }>; history: Array<{ id: string; name: string; tierName: string; season: number; teams: number; status: string }> }>("/v1/pyramid-leagues", ctx.from.id);
    const lines = result.tiers.map((tier) => tier.name + " · صف انتظار " + tier.waitingTeams + "/8"
      + (tier.myApplication ? " · درخواست شما: " + tier.myApplication : "")
      + (tier.leagues.length ? "\n" + tier.leagues.map((league) => "  " + league.name + " · " + league.teams + "/8 تیم" + (league.isMyLeague ? " · لیگ شما" : "") + " · " + league.status + " · " + league.id).join("\n") : ""));
    const history = result.history.slice(0, 12).map((league) => league.name + " · " + league.tierName + " · فصل " + league.season + " · شناسه " + league.id + "\n/pyramidtable " + league.id);
    const offers = result.promotionOffers.map((offer) =>
      "پیشنهاد صعود به سطح " + offer.targetTier + " · رتبه " + offer.finalPosition + " · شناسه " + offer.id
      + "\n/promotion " + offer.id + " accept یا decline");
    const keyboard = new InlineKeyboard();
    for (const tier of result.tiers) {
      if (!tier.myApplication && !tier.leagues.some((league) => league.isMyLeague)) keyboard.text("درخواست " + tier.name, "league:apply:" + tier.tier).row();
    }
    for (const offer of result.promotionOffers) keyboard.text("پذیرش صعود " + offer.targetTier, "promotion:accept:" + offer.id).text("رد", "promotion:decline:" + offer.id).row();
    await ctx.reply("🏆 هرم لیگ‌های سراسری · فصل " + result.season + "\n\n" + lines.join("\n\n")
      + "\n\n" + (history.length ? "آرشیو لیگ‌ها:\n" + history.join("\n\n") + "\n\n" : "")
      + (offers.length ? "پیشنهادهای صعود:\n" + offers.join("\n\n") + "\n\n" : "")
      + "برای درخواست ورود به سطح دلخواه، دکمه همان سطح را انتخاب کن.",
      { reply_markup: keyboard });
  } catch (error) { await ctx.reply("دریافت لیگ‌ها ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("leaguehistory", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{
      club: { name: string };
      stats: { seasons: number; appearances: number; championships: number; podiums: number; promotions: number; relegations: number };
      tiers: Array<{ tierName: string; appearances: number; championships: number; podiums: number; promotions: number; relegations: number }>;
      movements: Array<{ season: number; tierName: string; position: number; movement: string; targetTier?: number }>;
      leagues: Array<{ name: string; season: number; tierName: string; groupNumber: number; finalPosition: number | null; awards: Array<{ awardName: string }> }>;
    }>("/v1/pyramid-leagues/history", ctx.from.id);
    const s = result.stats;
    const tiers = result.tiers.map((row) => row.tierName + ": " + row.appearances + " حضور، " + row.championships + " قهرمانی، " + row.podiums + " سکو، " + row.promotions + " صعود، " + row.relegations + " سقوط");
    const movements = result.movements.slice(0, 20).map((row) =>
      "فصل " + row.season + " · " + row.tierName + " · رتبه " + row.position + " · " +
      (row.movement === "PROMOTION" ? "صعود به سطح " + row.targetTier : "سقوط به سطح پایین‌تر"));
    const history = result.leagues.slice(0, 20).map((row) =>
      "فصل " + row.season + " · " + row.tierName + " · گروه " + row.groupNumber +
      " · رتبه " + (row.finalPosition ?? "ثبت‌نشده") +
      (row.awards.length ? " · " + row.awards.map((award) => award.awardName).join("، ") : ""));
    await ctx.reply("افتخارات و تاریخچه باشگاه " + result.club.name +
      "\n\nفصل‌های حضور: " + s.seasons + " · حضور در لیگ‌ها: " + s.appearances +
      "\nقهرمانی: " + s.championships + " · سکو: " + s.podiums +
      "\nصعود: " + s.promotions + " · سقوط: " + s.relegations +
      "\n\nعملکرد در سطوح:\n" + (tiers.join("\n") || "هنوز سابقه‌ای ثبت نشده است.") +
      "\n\nتاریخچه صعود و سقوط:\n" + (movements.join("\n") || "حرکتی ثبت نشده است.") +
      "\n\nفصل‌های گذشته:\n" + (history.join("\n") || "هنوز فصل تکمیل‌شده‌ای ندارید."));
  } catch (error) { await ctx.reply("دریافت افتخارات باشگاه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("pyramidtable", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("استفاده: /pyramidtable LEAGUE_ID");
  try {
    const result = await api<{
      league: { name: string; tierName: string; season: number; status: string };
      standings: Array<{ position: number; clubName: string; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number }>;
      topScorers: Array<{ playerName: string; clubName: string; goals: number }>;
      topAssists: Array<{ playerName: string; clubName: string; assists: number }>;
      awards: Array<{ placement: number; awardName: string; clubName: string }>;
    }>("/v1/pyramid-leagues/" + encodeURIComponent(id), ctx.from.id);
    const table = result.standings.map((row) => row.position + ". " + row.clubName + " · " + row.points + " امتیاز · " + row.played + " بازی · " + row.won + "-" + row.drawn + "-" + row.lost + " · گل " + row.goalsFor + ":" + row.goalsAgainst);
    const scorers = result.topScorers.slice(0, 5).map((row) => row.playerName + " (" + row.clubName + ") · " + row.goals + " گل");
    const assists = result.topAssists.slice(0, 5).map((row) => row.playerName + " (" + row.clubName + ") · " + row.assists + " پاس گل");
    const awards = result.awards.map((row) => row.awardName + " · " + row.clubName);
    const plain = result.league.name + " · " + result.league.tierName + " · فصل " + result.league.season + "\n\nجدول:\n" + table.join("\n")
      + "\n\nگلزنان برتر:\n" + (scorers.join("\n") || "هنوز گلی ثبت نشده")
      + "\n\nپاسورهای برتر:\n" + (assists.join("\n") || "هنوز پاس گلی ثبت نشده")
      + (awards.length ? "\n\nجوایز:\n" + awards.join("\n") : "");
    const richTable = result.standings.map((row) => `<b>${row.position}. ${escapeHtml(row.clubName)}</b> · <b>${row.points}</b> امتیاز · ${row.played} بازی · ${row.won}-${row.drawn}-${row.lost} · گل ${row.goalsFor}:${row.goalsAgainst}`).join("\n");
    const rich = `🏆 <b>${escapeHtml(result.league.name)}</b> · ${escapeHtml(result.league.tierName)} · فصل ${result.league.season}\n\n<b>جدول لیگ</b>\n${richTable || "جدولی ثبت نشده است."}\n\n<b>گلزنان برتر</b>\n${scorers.map(escapeHtml).join("\n") || "هنوز گلی ثبت نشده"}\n\n<b>پاسورهای برتر</b>\n${assists.map(escapeHtml).join("\n") || "هنوز پاس گلی ثبت نشده"}${awards.length ? "\n\n<b>جوایز</b>\n" + awards.map(escapeHtml).join("\n") : ""}`;
    await replyRich(ctx, rich, plain);
  } catch (error) { await ctx.reply("دریافت جدول لیگ ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("leagueapply", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ status: string; waitingTeams: number; requiredTeams: number; leagueId?: string | null; tierName?: string; fixturesCreated?: number }>("/v1/pyramid-leagues/apply", ctx.from.id, "POST", { tier: 1 });
    await ctx.reply(result.status === "ASSIGNED"
      ? "درخواست شما پذیرفته شد و لیگ پایه با ۸ تیم تشکیل شد. مسابقات: " + (result.fixturesCreated ?? 0)
      : "درخواست ورود به لیگ پایه ثبت شد. " + result.waitingTeams + " تیم از ۸ تیم لازم در صف هستند. لیگ تا تکمیل ظرفیت شروع نمی‌شود.");
  } catch (error) { await ctx.reply("ثبت درخواست لیگ ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("promotion", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const [offerId, decision] = String(ctx.match ?? "").trim().split(/\s+/);
  if (!offerId || !["accept", "decline"].includes(decision ?? "")) return ctx.reply("روش استفاده: /promotion OFFER_ID accept|decline");
  try {
    const result = await api<{ accepted: boolean; replacementClubId?: string | null }>("/v1/pyramid-leagues/promotions/" + encodeURIComponent(offerId) + "/respond", ctx.from.id, "POST", { accept: decision === "accept" });
    await ctx.reply(result.accepted ? "صعود شما تأیید شد و در صف سطح بالاتر قرار گرفتید." : "انصراف ثبت شد. تیم بعدی جدول برای جایگزینی مطلع می‌شود.");
  } catch (error) { await ctx.reply("ثبت پاسخ صعود ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("leaguenotices", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ notices: Array<{ id: string; title: string; body: string; createdAt: string }> }>("/v1/league-notices", ctx.from.id);
    await ctx.reply("اعلان‌های لیگ:\n" + (result.notices.map((notice) => "• " + notice.title + "\n" + notice.body).join("\n\n") || "اعلان خوانده‌نشده‌ای ندارید."));
    await api("/v1/league-notices/read", ctx.from.id, "POST", {});
  } catch (error) { await ctx.reply("دریافت اعلان‌ها ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("matches", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ matches: Array<{
      id: string; type: string; status: string; scheduledAt: string;
      homeClub: { id: string; name: string }; awayClub: { id: string; name: string };
      homeScore: number | null; awayScore: number | null; homePenalties: number | null; awayPenalties: number | null;
      runtime: { status: string; currentMinute: number; nextActionAt: string | null } | null;
      checkpoints: Array<{ checkpointKey: string; minute: number; status: string; decisionDeadlineAt: string; homeDecisionSubmitted: boolean; awayDecisionSubmitted: boolean }>;
      events: Array<{ minute: number; type: string; playerName: string; relatedPlayerName: string | null }>;
    }> } >("/v1/matches", ctx.from.id);
    const keyboard = new InlineKeyboard();
    let hasActions = false;
    const lines = result.matches.map((match) => {
      const goals = match.events.filter((event) => event.type === "GOAL").map((event) => String(event.minute) + "′ " + event.playerName + (event.relatedPlayerName ? " (assist: " + event.relatedPlayerName + ")" : ""));
      const open = match.checkpoints.find((checkpoint) => checkpoint.status === "OPEN");
      if (open) {
        hasActions = true;
        keyboard.text("دفاعی · " + open.minute, "mc:" + match.id + ":" + open.checkpointKey + ":DEFENSIVE")
          .text("متعادل", "mc:" + match.id + ":" + open.checkpointKey + ":BALANCED")
          .text("هجومی", "mc:" + match.id + ":" + open.checkpointKey + ":ATTACKING").row();
      }
      return "• " + match.homeClub.name + " " + (match.homeScore ?? "–") + " : " + (match.awayScore ?? "–") + " " + match.awayClub.name
        + (match.homePenalties !== null ? " (pens " + match.homePenalties + "–" + match.awayPenalties + ")" : "")
        + "\n  " + match.type + " · " + (match.runtime ? "دقیقه " + match.runtime.currentMinute + " · " + match.runtime.status : match.status)
        + " · " + new Date(match.scheduledAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })
        + (open ? "\n  تصمیم تاکتیکی تا " + new Date(open.decisionDeadlineAt).toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran" }) + " · " + open.checkpointKey : "")
        + "\n  " + goals.join(" · ") + "\n  ID: " + match.id;
    });
    await ctx.reply("مسابقات شما:\n" + (lines.join("\n\n") || "هنوز مسابقه‌ای ندارید.")
      + (hasActions ? "\n\nبرای انتخاب سریع ذهنیت، از دکمه‌های زیر استفاده کنید. برای تنظیم کامل تاکتیک از /tactic و برای تعویض از /sub استفاده کنید." : ""),
      hasActions ? { reply_markup: keyboard } : {});
  } catch (error) { await ctx.reply("Could not load matches: " + (error instanceof Error ? error.message : "unknown error")); }
});

bot.callbackQuery(/^mc:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "این عملیات فقط در گفت‌وگوی خصوصی در دسترس است." });
  const parts = ctx.callbackQuery.data.split(":");
  const matchId = parts[1] ?? "";
  const checkpointKey = parts[2] ?? "";
  const mentality = parts[3] ?? "";
  if (!matchId || !/^minute-(45|60|75)$/.test(checkpointKey) || !["DEFENSIVE", "BALANCED", "ATTACKING"].includes(mentality)) {
    return ctx.answerCallbackQuery({ text: "داده دکمه معتبر نیست." });
  }
  try {
    await api("/v1/matches/" + encodeURIComponent(matchId) + "/checkpoints/" + encodeURIComponent(checkpointKey) + "/decisions",
      ctx.from.id, "POST", {
        idempotencyKey: "bot-match-" + ctx.from.id + "-" + ctx.update.update_id,
        instruction: { mentality },
      });
    await ctx.answerCallbackQuery({ text: "تصمیم تاکتیکی ثبت شد." });
    await ctx.reply("ذهنیت " + ({ DEFENSIVE: "دفاعی", BALANCED: "متعادل", ATTACKING: "هجومی" } as Record<string,string>)[mentality]
      + " برای مسابقه در دقیقه " + checkpointKey.replace("minute-", "") + " ثبت شد.");
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "ثبت تصمیم ناموفق بود." });
    await ctx.reply("ثبت تصمیم ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("tactic", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const parts = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const matchId = parts.shift() ?? "";
  const checkpointKey = parts.shift() ?? "";
  if (!matchId || !/^minute-(45|60|75)$/.test(checkpointKey)) {
    return ctx.reply("استفاده: /tactic MATCH_ID minute-45 mentality=ATTACKING pressing=HIGH_PRESS tempo=FAST passingStyle=DIRECT formation=4-3-3");
  }
  const allowed: Record<string,string[]> = {
    formation: ["4-3-3","4-4-2","3-5-2","4-2-3-1"],
    mentality: ["DEFENSIVE","BALANCED","ATTACKING"],
    pressing: ["LOW_BLOCK","MID_BLOCK","HIGH_PRESS"],
    tempo: ["SLOW","NORMAL","FAST"],
    passingStyle: ["SHORT","MIXED","DIRECT"],
  };
  const instruction: Record<string,string> = {};
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator < 1) return ctx.reply("هر تنظیم باید به شکل key=value باشد.");
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1).toUpperCase();
    if (!allowed[key]?.includes(value)) return ctx.reply("تنظیم نامعتبر: " + part);
    instruction[key] = value;
  }
  if (!Object.keys(instruction).length) return ctx.reply("حداقل یک تنظیم تاکتیکی وارد کنید.");
  try {
    await api("/v1/matches/" + encodeURIComponent(matchId) + "/checkpoints/" + encodeURIComponent(checkpointKey) + "/decisions",
      ctx.from.id, "POST", { idempotencyKey: "bot-tactic-" + ctx.from.id + "-" + ctx.update.update_id, instruction });
    await ctx.reply("تنظیمات تاکتیکی ثبت شد.");
  } catch (error) { await ctx.reply("ثبت تاکتیک ناموفق بود: " + (error instanceof Error ? error.message : "unknown error")); }
});

bot.command("sub", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const parts = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const matchId = parts.shift() ?? "";
  const checkpointKey = parts.shift() ?? "";
  if (!matchId || !/^minute-(45|60|75)$/.test(checkpointKey) || parts.length < 2 || parts.length > 10 || parts.length % 2 !== 0) {
    return ctx.reply("استفاده: /sub MATCH_ID minute-45 OUTGOING_PLAYER_ID INCOMING_PLAYER_ID [OUT_ID IN_ID ...] (حداکثر ۵ تعویض)");
  }
  const substitutions = [];
  for (let i = 0; i < parts.length; i += 2) substitutions.push({ outgoingPlayerId: parts[i], incomingPlayerId: parts[i + 1] });
  try {
    await api("/v1/matches/" + encodeURIComponent(matchId) + "/checkpoints/" + encodeURIComponent(checkpointKey) + "/decisions",
      ctx.from.id, "POST", { idempotencyKey: "bot-sub-" + ctx.from.id + "-" + ctx.update.update_id, instruction: { substitutions } });
    await ctx.reply(substitutions.length + " تعویض برای این وقفه ثبت شد؛ اعتبار بازیکنان و سقف‌های مسابقه در سرور بررسی می‌شوند.");
  } catch (error) { await ctx.reply("ثبت تعویض ناموفق بود: " + (error instanceof Error ? error.message : "unknown error")); }
});

bot.command("fallback", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{plan:{formation:string;mentality:string;pressing:string;tempo:string;passingStyle:string};version:number;isCustom:boolean}>(
      "/v1/matches/fallback-plan", ctx.from.id);
    const p=result.plan;
    await ctx.reply("برنامه جایگزین مسابقه شما" + (result.isCustom ? " · سفارشی" : " · پیش‌فرض تاکتیک باشگاه")
      + "\nآرایش: "+p.formation+"\nذهنیت: "+p.mentality+"\nپرس: "+p.pressing
      +"\nسرعت: "+p.tempo+"\nپاس: "+p.passingStyle
      +"\nنسخه: "+result.version
      +"\nبرای تغییر: /setfallback formation=4-4-2 mentality=DEFENSIVE pressing=LOW_BLOCK tempo=SLOW passingStyle=SHORT");
  } catch (error) {
    await ctx.reply("دریافت برنامه جایگزین ناموفق بود: "+(error instanceof Error?error.message:"unknown error"));
  }
});

bot.command("setfallback", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const allowed: Record<string, string[]> = {
    formation: ["4-3-3", "4-4-2", "3-5-2", "4-2-3-1"],
    mentality: ["DEFENSIVE", "BALANCED", "ATTACKING"],
    pressing: ["LOW_BLOCK", "MID_BLOCK", "HIGH_PRESS"],
    tempo: ["SLOW", "NORMAL", "FAST"],
    passingStyle: ["SHORT", "MIXED", "DIRECT"],
  };
  const raw = String(ctx.match ?? "").trim();
  if (raw) {
    const changes: Record<string, string> = {};
    for (const part of raw.split(/\\s+/).filter(Boolean)) {
      const i = part.indexOf("=");
      if (i < 1) return ctx.reply("هر تنظیم باید به شکل key=value باشد.");
      const key = part.slice(0, i), value = part.slice(i + 1).toUpperCase();
      if (!allowed[key]?.includes(value)) return ctx.reply("مقدار نامعتبر: " + part);
      changes[key] = value;
    }
    try {
      const current = await api<{ plan: Record<string, string>; version: number }>("/v1/matches/fallback-plan", ctx.from.id);
      const saved = await api<{ version: number }>("/v1/matches/fallback-plan", ctx.from.id, "PUT", { expectedVersion: current.version, plan: { ...current.plan, ...changes } });
      return ctx.reply("برنامه جایگزین ذخیره شد. نسخه " + saved.version + "؛ از مسابقه بعدی اعمال خواهد شد.");
    } catch (error) { return ctx.reply("ذخیره برنامه جایگزین ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
  }
  try {
    const current = await api<{ plan: Record<string, string>; version: number }>("/v1/matches/fallback-plan", ctx.from.id);
    pendingFallbackEdits.set(ctx.from.id, { plan: { ...current.plan }, version: current.version });
    const keyboard = new InlineKeyboard()
      .text("آرایش", "fallback:field:formation").text("ذهنیت", "fallback:field:mentality").row()
      .text("پرس", "fallback:field:pressing").text("سرعت", "fallback:field:tempo").row()
      .text("سبک پاس", "fallback:field:passingStyle").row().text("لغو", "fallback:cancel");
    await ctx.reply("🧠 <b>تنظیم تاکتیک پیش‌فرض</b>\n" + Object.entries(current.plan).map(([key, value]) => key + ": " + value).join("\\n") + "\nیک بخش را برای تغییر انتخاب کن.", { parse_mode: "HTML", reply_markup: keyboard });
  } catch (error) { await ctx.reply("دریافت برنامه جایگزین ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.callbackQuery(/^fallback:/, async (ctx) => {
  if (!ctx.from || ctx.chat?.type !== "private") return ctx.answerCallbackQuery({ text: "تنظیم تاکتیک فقط در گفت‌وگوی خصوصی مجاز است." });
  const state = pendingFallbackEdits.get(ctx.from.id);
  if (!state) return ctx.answerCallbackQuery({ text: "فرایند منقضی شده است؛ دوباره /setfallback را باز کن." });
  const [, action, field, value] = ctx.callbackQuery.data.split(":");
  const allowed: Record<string, string[]> = {
    formation: ["4-3-3", "4-4-2", "3-5-2", "4-2-3-1"],
    mentality: ["DEFENSIVE", "BALANCED", "ATTACKING"],
    pressing: ["LOW_BLOCK", "MID_BLOCK", "HIGH_PRESS"],
    tempo: ["SLOW", "NORMAL", "FAST"],
    passingStyle: ["SHORT", "MIXED", "DIRECT"],
  };
  if (action === "cancel") {
    pendingFallbackEdits.delete(ctx.from.id);
    await ctx.answerCallbackQuery({ text: "تغییرات لغو شد." });
    await ctx.editMessageText("تنظیم تاکتیک لغو شد.");
    return;
  }
  if (action === "field") {
    if (!field || !allowed[field]) return ctx.answerCallbackQuery({ text: "بخش معتبر نیست." });
    const keyboard = new InlineKeyboard();
    for (const option of allowed[field]) keyboard.text(option, "fallback:value:" + field + ":" + option);
    keyboard.row().text("بازگشت", "fallback:back");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("مقدار جدید برای " + field + " را انتخاب کن:", { reply_markup: keyboard });
    return;
  }
  if (action === "value") {
    if (!field || !allowed[field]?.includes(value ?? "")) return ctx.answerCallbackQuery({ text: "مقدار معتبر نیست." });
    state.plan[field] = value!;
  } else if (action !== "back" && action !== "save") return ctx.answerCallbackQuery({ text: "گزینه معتبر نیست." });
  if (action === "save") {
    try {
      const saved = await api<{ version: number }>("/v1/matches/fallback-plan", ctx.from.id, "PUT", { expectedVersion: state.version, plan: state.plan });
      pendingFallbackEdits.delete(ctx.from.id);
      await ctx.answerCallbackQuery({ text: "تاکتیک ذخیره شد." });
      await ctx.editMessageText("✅ تاکتیک پیش‌فرض ذخیره شد؛ نسخه " + saved.version + ". از مسابقه بعدی اعمال می‌شود.");
      return;
    } catch (error) {
      pendingFallbackEdits.delete(ctx.from.id);
      await ctx.answerCallbackQuery({ text: "ذخیره ناموفق بود." });
      await ctx.reply("ذخیره تاکتیک ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
      return;
    }
  }
  const keyboard = new InlineKeyboard()
    .text("آرایش", "fallback:field:formation").text("ذهنیت", "fallback:field:mentality").row()
    .text("پرس", "fallback:field:pressing").text("سرعت", "fallback:field:tempo").row()
    .text("سبک پاس", "fallback:field:passingStyle").row()
    .text("✅ ذخیره تاکتیک", "fallback:save").text("لغو", "fallback:cancel");
  await ctx.answerCallbackQuery({ text: action === "value" ? "مقدار تغییر کرد." : "تنظیمات" });
  await ctx.editMessageText("🧠 <b>تاکتیک پیش‌فرض</b>\n" + Object.entries(state.plan).map(([key, item]) => key + ": " + item).join("\\n") + "\nبرای تغییر بخش دیگر انتخاب کن یا ذخیره را بزن.", { parse_mode: "HTML", reply_markup: keyboard });
});

bot.command("play", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  await ctx.reply("مسابقات Football Empire به‌صورت خودکار اجرا می‌شوند و به شروع دستی نیاز ندارند. برای مشاهده وضعیت، دستور /matches را بزنید.");
});
bot.command("league", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const parts = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const last = parts.at(-1);
  const maxTeams = last && /^\d+$/.test(last) ? Number(parts.pop()) : 8;
  const name = parts.join(" ");
  if (name.length < 3 || name.length > 40 || !Number.isInteger(maxTeams) || maxTeams < 4 || maxTeams > 10) {
    return ctx.reply("روش استفاده: /league LEAGUE NAME [4-10]");
  }
  try {
    const result = await api<{ competition: { id: string; name: string; maxTeams: number }; replayed: boolean }>("/v1/competitions", ctx.from.id, "POST", {
      name, maxTeams, idempotencyKey: `bot-league-${ctx.from.id}-${ctx.update.update_id}`,
    });
    await ctx.reply(`لیگ «${result.competition.name}» ایجاد شد.\nشناسه: ${result.competition.id}\nظرفیت: ${result.competition.maxTeams} باشگاه\nبرای دعوت مدیران دیگر از /leagues استفاده کنید.`);
  } catch (error) { await ctx.reply(`ایجاد لیگ ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("cup", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const parts = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const legsToken = parts.find((part) => part.startsWith("legs="));
  const cupLegs = legsToken ? Number(legsToken.slice(5)) : 1;
  if (legsToken) parts.splice(parts.indexOf(legsToken), 1);
  const capacityToken = parts.find((part) => /^[48]$/.test(part));
  const maxTeams = capacityToken ? Number(capacityToken) : 4;
  if (capacityToken) parts.splice(parts.indexOf(capacityToken), 1);
  const name = parts.join(" ");
  if (name.length < 3 || name.length > 40 || ![4, 8].includes(maxTeams) || ![1, 2].includes(cupLegs)) {
    return ctx.reply("روش استفاده: /cup CUP NAME [4|8] [legs=1|2]");
  }
  try {
    const result = await api<{ competition: { id: string; name: string; maxTeams: number; cupLegs:number }; replayed: boolean }>("/v1/competitions", ctx.from.id, "POST", {
      name, maxTeams, format: "CUP", cupLegs, idempotencyKey: "bot-cup-" + ctx.from.id + "-" + ctx.update.update_id,
    });
    await ctx.reply("Knockout cup created: " + result.competition.name + "\nID: " + result.competition.id
      + "\nBracket: " + result.competition.maxTeams + " clubs · "
      + (result.competition.cupLegs === 2 ? "two-legged ties" : "single-match ties")
      + ". Fill all places before starting.");
  } catch (error) { await ctx.reply("ایجاد جام حذفی ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});
bot.command("competitionrules", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const parts = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const competitionId = parts.shift();
  if (!competitionId) return ctx.reply("روش استفاده: /competitionrules COMPETITION_ID subs=5 windows=3 injuries=on red=1 yellow=3 yellowban=1 penalties=on");
  try {
    const current = await api<{ competition: { rules: {
      maxSubstitutions:number; maxInPlayWindows:number; injuriesEnabled:boolean; injuryDurationDays:number;
      redCardSuspensionMatches:number; yellowCardsToSuspend:number;
      yellowCardSuspensionMatches:number; penaltiesOnDraw:boolean;
    } } }>("/v1/competitions/" + competitionId, ctx.from.id);
    const rules = { ...current.competition.rules };
    const keys: Record<string, keyof typeof rules> = {
      subs:"maxSubstitutions", windows:"maxInPlayWindows", injurydays:"injuryDurationDays", red:"redCardSuspensionMatches",
      yellow:"yellowCardsToSuspend", yellowban:"yellowCardSuspensionMatches",
    };
    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key === "injuries" && (value === "on" || value === "off")) rules.injuriesEnabled = value === "on";
      else if (key === "penalties" && (value === "on" || value === "off")) rules.penaltiesOnDraw = value === "on";
      else if (key && value && keys[key] && /^\d+$/.test(value)) {
        (rules[keys[key]] as number) = Number(value);
      } else return ctx.reply("قانون نامعتبر است: " + part);
    }
    const saved = await api<{ rules: typeof rules }>("/v1/competitions/" + competitionId + "/rules", ctx.from.id, "PUT", rules);
    await ctx.reply("Competition rules saved. Substitutions: " + saved.rules.maxSubstitutions
      + ", in-play windows: " + saved.rules.maxInPlayWindows
      + ", injuries: " + (saved.rules.injuriesEnabled ? "on" : "off") + " (" + saved.rules.injuryDurationDays + " days)"
      + ", red-card ban: " + saved.rules.redCardSuspensionMatches
      + ", yellow-card threshold: " + saved.rules.yellowCardsToSuspend
      + ", yellow-card ban: " + saved.rules.yellowCardSuspensionMatches
      + ", penalties on draw: " + (saved.rules.penaltiesOnDraw ? "on" : "off") + ".");
  } catch (error) {
    await ctx.reply("ذخیره قوانین رقابت ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("leagues", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ competitions: Array<{ id: string; name: string; season: number; format: string; status?: string; teams: number; maxTeams: number; joined: boolean; isCreator: boolean }> }>("/v1/competitions", ctx.from.id);
    const keyboard = new InlineKeyboard();
    for (const item of result.competitions.slice(0, 20)) {
      if (item.joined && item.isCreator && item.teams >= 4) keyboard.text("🚦 آغاز · " + item.name.slice(0, 20), "league:start:" + item.id).row();
      else if (!item.joined && item.teams < item.maxTeams && (!item.status || item.status === "REGISTRATION")) keyboard.text("➕ عضویت · " + item.name.slice(0, 24), "league:join:" + item.id).row();
    }
    keyboard.text("🏅 درخواست لیگ پایه", "league:apply:1").text("⚔️ ساخت چالش", "act:challenge");
    const lines = result.competitions.map((item) =>
      `• <b>${escapeHtml(item.name)}</b> · ${item.format === "CUP" ? "جام حذفی" : "لیگ"} · ${item.teams}/${item.maxTeams} باشگاه · فصل ${item.season}${item.joined ? " · عضو هستید" : ""}`
    );
    await replyRich(
      ctx,
      "🏆 <b>رقابت‌های قابل ثبت‌نام</b>\n\n" + (lines.join("\n") || "در حال حاضر رقابتی برای ثبت‌نام وجود ندارد.") +
      "\n\nبرای عضویت، دکمه رقابت موردنظر را انتخاب کن. برای ورود به هرم لیگ‌ها نیز درخواست لیگ پایه را بزن.",
      "رقابت‌های قابل ثبت‌نام\n" + result.competitions.map((item) => item.name + " · " + item.teams + "/" + item.maxTeams + (item.joined ? " · عضو هستید" : " · /joinleague " + item.id)).join("\n"),
      keyboard,
    );
  } catch (error) { await ctx.reply(`دریافت رقابت‌ها ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("joinleague", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("روش استفاده: /joinleague COMPETITION_ID");
  try {
    const result = await api<{ joined: boolean; replayed: boolean; teams: number }>(`/v1/competitions/${encodeURIComponent(id)}/join`, ctx.from.id, "POST", {});
    await ctx.reply(`ثبت‌نام شما در رقابت انجام شد. تعداد تیم‌ها: ${result.teams}.`);
  } catch (error) { await ctx.reply(`عضویت در رقابت ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("startleague", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("روش استفاده: /startleague COMPETITION_ID");
  try {
    const result = await api<{ fixturesCreated: number; rounds: number; teams: number }>(`/v1/competitions/${encodeURIComponent(id)}/start`, ctx.from.id, "POST", {});
    await ctx.reply(`لیگ با ${result.teams} باشگاه آغاز شد. ${result.fixturesCreated} مسابقه در ${result.rounds} هفته برنامه‌ریزی شد.`);
  } catch (error) { await ctx.reply(`آغاز لیگ ناموفق بود: ${error instanceof Error ? error.message : "خطای نامشخص"}`); }
});

bot.command("startcup", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("روش استفاده: /startcup CUP_ID");
  try {
    const result = await api<{ fixturesCreated: number; rounds: number; teams: number; replayed?: boolean }>(`/v1/competitions/${encodeURIComponent(id)}/start`, ctx.from.id, "POST", {});
    await ctx.reply("جام حذفی با " + result.teams + " باشگاه آغاز شد. " + result.fixturesCreated + " مسابقه در دور نخست و " + result.rounds + " دور حذفی برنامه‌ریزی شد.");
  } catch (error) { await ctx.reply("آغاز جام حذفی ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});
bot.command("table", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("روش استفاده: /table COMPETITION_ID");
  try {
    const result = await api<{ competition: { name: string; status: string; format: string }; standings: Array<{ position: number; clubName: string; played: number; won: number; drawn: number; lost: number; goalDifference: number; points: number }>; matches: Array<{ round: number | null; homeClub: { name: string }; awayClub: { name: string }; homeScore: number | null; awayScore: number | null; homePenalties: number | null; awayPenalties: number | null }> }>(`/v1/competitions/${encodeURIComponent(id)}`, ctx.from.id);
    const rows = result.competition.format === "CUP"
      ? result.matches.map((match) => "دور " + match.round + ": " + match.homeClub.name + " " + (match.homeScore ?? "–") + "–" + (match.awayScore ?? "–") + " " + match.awayClub.name + (match.homePenalties !== null ? " (پنالتی " + match.homePenalties + "–" + match.awayPenalties + ")" : ""))
      : result.standings.map((row) => row.position + ". " + row.clubName + " · امتیاز " + row.points + " · بازی " + row.played + " · برد " + row.won + " · مساوی " + row.drawn + " · باخت " + row.lost + " · تفاضل " + row.goalDifference);
    const statusLabel = ({DRAFT:"پیش‌نویس",REGISTRATION:"ثبت‌نام",ACTIVE:"در جریان",COMPLETED:"پایان‌یافته",CANCELLED:"لغوشده"} as Record<string,string>)[result.competition.status] ?? result.competition.status;
    const plain = result.competition.name + " · " + statusLabel + "\n\n" + rows.join("\n");
    const richRows = result.competition.format === "CUP"
      ? result.matches.map((match) => `<b>دور ${match.round ?? "—"}</b>\n${escapeHtml(match.homeClub.name)} <b>${match.homeScore ?? "–"}–${match.awayScore ?? "–"}</b> ${escapeHtml(match.awayClub.name)}${match.homePenalties !== null ? ` · پنالتی ${match.homePenalties}–${match.awayPenalties}` : ""}`)
      : result.standings.map((row) => `<b>${row.position}. ${escapeHtml(row.clubName)}</b>\nامتیاز: <b>${row.points}</b> · بازی: ${row.played} · برد: ${row.won} · مساوی: ${row.drawn} · باخت: ${row.lost} · تفاضل: ${row.goalDifference}`);
    await replyRich(ctx, `🏆 <b>${escapeHtml(result.competition.name)}</b> · ${escapeHtml(statusLabel)}\n\n${richRows.join("\n\n") || "هنوز اطلاعاتی ثبت نشده است."}`, plain);
  } catch (error) { await ctx.reply("دریافت جدول رقابت ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});


bot.command("alliance", async ctx => {
  if (!ctx.from || !["group","supergroup"].includes(ctx.chat.type)) return;
  try {
    const d = await api<{alliance:{name:string;treasuryPoints:string;groups:Array<{title:string;memberCount:number}>;seasons:Array<{number:number;status:string;reviewStatus:string}>;competitions:Array<{id:string;name:string;status:string;teams:number}>}|null;invitations:Array<{id:string;alliance:{name:string}}>}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id)),ctx.from.id);
    if (!d.alliance) return ctx.reply("گروه عضو اتحادی نیست. دعوت‌ها:\n"+(d.invitations.length?d.invitations.map(x=>x.id+" · "+x.alliance.name).join("\n"):"دعوتی ندارید."));
    return ctx.reply("اتحاد: "+d.alliance.name+"\nخزانه: "+d.alliance.treasuryPoints+"\nگروه‌ها:\n"+d.alliance.groups.map(x=>x.title+" · "+x.memberCount+" عضو").join("\n")+"\nفصل‌ها: "+d.alliance.seasons.map(x=>"#"+x.number+" "+x.status+" · "+x.reviewStatus).join("، ")+"\nقهرمانی‌ها:\n"+d.alliance.competitions.map(x=>x.id+" · "+x.name+" · "+x.status+" · "+x.teams+" تیم").join("\n"));
  } catch(e) { await ctx.reply("اتحاد در دسترس نیست: "+(e instanceof Error?e.message:"unknown")); }
});
bot.command("alliance-create", async ctx => {
  if (!ctx.from || !["group","supergroup"].includes(ctx.chat.type)) return;
  const name=String(ctx.match??"").trim(); if(name.length<3||name.length>60)return ctx.reply("استفاده: /alliance-create نام اتحاد");
  try { const d=await api<{alliance:{name:string}}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id)),ctx.from.id,"POST",{name,idempotencyKey:"alliance_"+randomUUID().replace(/-/g,"")}); await ctx.reply("اتحاد «"+d.alliance.name+"» ایجاد شد."); }
  catch(e){await ctx.reply("ایجاد اتحاد ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-invite", async ctx => {
  if (!ctx.from || !["group","supergroup"].includes(ctx.chat.type)) return;
  const target=String(ctx.match??"").trim(); if(!/^-?\d{1,20}$/.test(target))return ctx.reply("استفاده: /alliance-invite TELEGRAM_GROUP_ID");
  try { const d=await api<{alliance:{name:string};invitation:{id:string}}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/invitations",ctx.from.id,"POST",{targetTelegramGroupId:target}); await ctx.reply("دعوت ارسال شد؛ شناسه: "+d.invitation.id+" · "+d.alliance.name); }
  catch(e){await ctx.reply("ارسال دعوت ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
for (const [command,accept] of [["alliance-accept",true],["alliance-decline",false]] as const) bot.command(command,async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  const id=String(ctx.match??"").trim(); if(!id)return ctx.reply("شناسه دعوت را وارد کنید.");
  try { const d=await api<{accepted:boolean}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/invitations/"+encodeURIComponent(id)+"/respond",ctx.from.id,"POST",{accept}); await ctx.reply(d.accepted?"دعوت اتحاد پذیرفته شد.":"دعوت اتحاد رد شد."); }
  catch(e){await ctx.reply("پاسخ به دعوت ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-championship",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  const parts=String(ctx.match??"").trim().split("|"); const name=parts[0]??""; const maxTeams=Number(parts[1]??8);
  if(name.trim().length<3||!Number.isInteger(maxTeams)||maxTeams<4||maxTeams>20)return ctx.reply("استفاده: /alliance-championship نام مسابقات|ظرفیت (۴ تا ۲۰)");
  try { const d=await api<{competition:{id:string;name:string}}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/championships",ctx.from.id,"POST",{name:name.trim(),maxTeams,idempotencyKey:"alliance_comp_"+randomUUID().replace(/-/g,"")}); await ctx.reply("قهرمانی ساخته شد: "+d.competition.name+"\nشناسه: "+d.competition.id); }
  catch(e){await ctx.reply("ساخت قهرمانی ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-championship-join",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return; const id=String(ctx.match??"").trim(); if(!id)return ctx.reply("شناسه قهرمانی را وارد کنید.");
  try { const d=await api<{teams:number}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/championships/"+encodeURIComponent(id)+"/join",ctx.from.id,"POST"); await ctx.reply("ثبت‌نام انجام شد. تعداد تیم‌ها: "+d.teams); }
  catch(e){await ctx.reply("ثبت‌نام ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-championship-start",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return; const id=String(ctx.match??"").trim(); if(!id)return ctx.reply("شناسه قهرمانی را وارد کنید.");
  try { await api("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/championships/"+encodeURIComponent(id)+"/start",ctx.from.id,"POST"); await ctx.reply("قهرمانی آغاز شد."); }
  catch(e){await ctx.reply("شروع قهرمانی ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-season-start",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return; const durationDays=Number(String(ctx.match??"30").trim()); if(!Number.isInteger(durationDays)||durationDays<7||durationDays>90)return ctx.reply("مدت فصل باید بین ۷ تا ۹۰ روز باشد.");
  try { const d=await api<{season:{number:number;endsAt:string}}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/seasons",ctx.from.id,"POST",{durationDays}); await ctx.reply("فصل "+d.season.number+" آغاز شد؛ پایان: "+new Date(d.season.endsAt).toLocaleDateString("fa-IR")); }
  catch(e){await ctx.reply("شروع فصل ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});
bot.command("alliance-season-close",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  try {
    const d=await api<{standings:Array<{rank:number;group:string;points:string}>;reviewStatus:string;securityFlags?:Array<{code:string;group?:string;sharePercent?:number;groups?:Array<{group:string}>}>;winner?:string|null;prize?:string}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/seasons/close",ctx.from.id,"POST");
    const status=d.reviewStatus==="FLAGGED"?"\nجایزه تا بررسی امنیتی مسدود شد. هشدارها: "+(d.securityFlags??[]).map(x=>x.code==="SINGLE_MEMBER_CONCENTRATION"?x.group+" ("+x.sharePercent+"%)":"هم‌پوشانی "+(x.groups??[]).map(g=>g.group).join("، ")).join("؛ "):"\nوضعیت بررسی: تأیید خودکار";
    await ctx.reply("جدول نهایی فصل:\n"+d.standings.map(x=>x.rank+". "+x.group+" · "+x.points+" امتیاز").join("\n")+status+(d.prize&&d.prize!=="0"?"\nجایزه: "+cash(d.prize):""));
  }
  catch(e){await ctx.reply("بستن فصل ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});

bot.command("alliance-season-review",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  const parts=String(ctx.match??"").trim().split(/\s+/);
  const seasonId=parts[0]??"", decision=parts[1]?.toLowerCase();
  if(!seasonId||!["approve","reject"].includes(decision??""))return ctx.reply("استفاده: /alliance-season-review SEASON_ID approve|reject\nفقط بازبین مجاز اتحاد می‌تواند جایزه مشکوک را تأیید یا رد کند.");
  try {
    const d=await api<{reviewStatus:string;winner?:string|null;prize?:string}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/seasons/"+encodeURIComponent(seasonId)+"/review",ctx.from.id,"POST",{decision:decision==="approve"?"APPROVE":"REJECT"});
    await ctx.reply("بررسی امنیتی فصل ثبت شد: "+d.reviewStatus+(d.winner?"\nقهرمان: "+d.winner:"")+(d.prize&&d.prize!=="0"?"\nجایزه پرداخت‌شده: "+cash(d.prize):""));
  } catch(e){await ctx.reply("بررسی فصل ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});

bot.command("alliance-contribute",async ctx=>{
  if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;
  const amount=String(ctx.match??"").trim(); if(!/^\d{1,12}$/.test(amount)||BigInt(amount)<=BigInt(0))return ctx.reply("استفاده: /alliance-contribute AMOUNT");
  try{const d=await api<{treasuryPoints:string}>("/v1/alliances/"+encodeURIComponent(String(ctx.chat.id))+"/treasury/contribute",ctx.from.id,"POST",{amount,idempotencyKey:"alliance_contrib_"+randomUUID().replace(/-/g,"")});await ctx.reply("مشارکت در خزانه اتحاد ثبت شد. موجودی خزانه: "+cash(d.treasuryPoints)+" امتیاز.");}
  catch(e){await ctx.reply("واریز ناموفق بود: "+(e instanceof Error?e.message:"unknown"));}
});

bot.command("setlogo", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  await ctx.reply("برای انتخاب لوگوی باشگاه، تصویر را در همین گفت‌وگوی خصوصی ارسال کنید یا از یک گفت‌وگوی دیگر برای ربات فوروارد کنید. فرمت‌های JPG، PNG و WEBP تا حجم ۵۱۲ کیلوبایت پذیرفته می‌شوند.");
});
bot.on("message:photo", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const photo = ctx.message.photo.at(-1);
  if (!photo) return;
  await saveTelegramClubLogo(ctx, photo.file_id, "image/jpeg", photo.file_size);
});
bot.on("message:document", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const document = ctx.message.document;
  if (!document.mime_type?.startsWith("image/")) return;
  await saveTelegramClubLogo(ctx, document.file_id, document.mime_type, document.file_size);
});


bot.command("seasonawards", async (ctx) => {
  const raw = String(ctx.match ?? "").trim();
  const season = raw ? Number(raw) : new Date().getUTCFullYear();
  if (!Number.isInteger(season) || season < 2020 || season > 2200) return ctx.reply("استفاده: /seasonawards [YEAR]");
  try {
    const result = await publicApi<{ season:number; matches:number; manualAwards:Array<{awardName:string;playerName:string;clubName:string;reason:string|null}>; awards:{topScorer:{playerName:string;clubName:string;goals:number}|null;topAssists:{playerName:string;clubName:string;assists:number}|null;playerOfSeason:{playerName:string;clubName:string;averageRating:number}|null;teamOfSeason:Array<{playerName:string;clubName:string;position:string;averageRating:number}>};leaders:{scorers:Array<{playerName:string;clubName:string;goals:number}>;assists:Array<{playerName:string;clubName:string;assists:number}>} }>(
      "/v1/seasons/" + season + "/awards",
    );
    const line = (label:string, row:{playerName:string;clubName:string}|null, stat:string) => label + ": " + (row ? row.playerName + " · " + row.clubName + " · " + stat : "ثبت نشده");
    const team = result.awards.teamOfSeason.map((p,i)=>(i+1)+". "+p.playerName+" · "+p.position+" · "+p.clubName+" · "+p.averageRating.toFixed(2));
    await ctx.reply("آرشیو فصل "+result.season+" · "+result.matches+" مسابقه\n\n"+
      line("بهترین گلزن",result.awards.topScorer,result.awards.topScorer?.goals+" گل")+"\n"+
      line("بهترین پاسور",result.awards.topAssists,result.awards.topAssists?.assists+" پاس گل")+"\n"+
      line("بازیکن فصل",result.awards.playerOfSeason,result.awards.playerOfSeason?.averageRating.toFixed(2)+" امتیاز")+
      "\n\nتیم منتخب فصل ۴-۳-۳:\n"+(team.join("\n")||"اطلاعات کافی نیست")+(result.manualAwards.length?"\n\nجوایز رسمی مدیریت:\n"+result.manualAwards.map(a=>a.awardName+" · "+a.playerName+" · "+a.clubName+(a.reason?" · "+a.reason:"")).join("\n"):""));
  } catch(error) { await ctx.reply("دریافت آرشیو فصل ناموفق بود: "+(error instanceof Error?error.message:"خطای نامشخص")); }
});

bot.command("records", async (ctx) => {
  const requested = String(ctx.match ?? "").trim().toLowerCase().split(" ")[0] ?? "";
  const aliases: Record<string, "goals" | "assists" | "appearances" | "rating"> = {
    goals: "goals", scorers: "goals", assists: "assists", appearances: "appearances", matches: "appearances", rating: "rating",
    گل: "goals", گلزنان: "goals", پاس: "assists", بازی: "appearances", نمره: "rating",
  };
  const metric = requested ? aliases[requested] : "goals";
  if (!metric) return ctx.reply("استفاده: /records [goals|assists|appearances|rating]");
  try {
    const result = await publicApi<{ records: Array<{ rank: number; playerName: string; clubName: string; position: string; appearances: number; goals: number; assists: number; averageRating: number; value: number }>; metric: string }>(
      "/v1/players/records?metric=" + metric + "&limit=10",
    );
    const title = ({ goals: "رتبه‌بندی بهترین گلزنان تاریخ", assists: "رتبه‌بندی بهترین پاسورهای تاریخ", appearances: "رتبه‌بندی بیشترین بازی", rating: "رتبه‌بندی بالاترین میانگین نمره" } as const)[metric];
    const lines = result.records.map((record) => record.rank + ". " + record.playerName + " · " + record.clubName + " (" + record.position + ") · " +
      (metric === "rating" ? record.value.toFixed(2) : record.value.toLocaleString("fa-IR")) +
      " · " + record.appearances + " بازی · " + record.goals + " گل · " + record.assists + " پاس گل");
    await ctx.reply([title, "", ...(lines.length ? lines : ["هنوز رکوردی ثبت نشده است."]),
      ...(metric === "rating" ? ["", "حداقل ۳ حضور برای ورود به این رتبه‌بندی لازم است."] : [])].join("\n"));
  } catch (error) { await ctx.reply("دریافت رکوردها ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("clubs", async (ctx) => {
  try {
    const result = await publicApi<{ clubs: Array<{ id: string; name: string; level: number; championships: number; podiums: number; logoUrl: string | null }> }>("/v1/clubs/public");
    const lines = result.clubs.slice(0, 12).map((club, index) =>
      (index + 1) + ". " + club.name + " · شناسه " + club.id + " · سطح " + club.level + " · " + club.championships + " قهرمانی · " + club.podiums + " سکو" + (club.logoUrl ? " · دارای لوگو" : ""));
    await ctx.reply("باشگاه‌های Football Empire\n\n" + (lines.join("\n") || "هنوز باشگاهی ثبت نشده است.") + "\n\nبرای مشاهده پروفایل: /clubprofile CLUB_ID");
  } catch (error) { await ctx.reply("دریافت فهرست باشگاه‌ها ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("clubcompare", async (ctx) => {
  const ids = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  if (ids.length !== 2 || ids[0] === ids[1]) return ctx.reply("استفاده: /clubcompare CLUB_ID_1 CLUB_ID_2");
  try {
    const result = await publicApi<{ clubs: Array<{ name: string; level: number; record: { played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; goalDifference: number; biggestWin: { score: string; opponent: string } | null } }>; headToHead: { totalMatches: number; recentMatches: Array<{ homeClub: string; awayClub: string; homeScore: number | null; awayScore: number | null; date: string }> } }>(
      "/v1/clubs/compare?first=" + encodeURIComponent(ids[0]!) + "&second=" + encodeURIComponent(ids[1]!),
    );
    const lines = result.clubs.map((club) => club.name + " · سطح " + club.level + "\n" +
      club.record.played + " بازی · " + club.record.won + " برد · " + club.record.drawn + " مساوی · " + club.record.lost + " باخت\n" +
      "گل " + club.record.goalsFor + "-" + club.record.goalsAgainst + " · تفاضل " + club.record.goalDifference +
      (club.record.biggestWin ? " · بهترین برد " + club.record.biggestWin.score + " مقابل " + club.record.biggestWin.opponent : ""));
    const recent = result.headToHead.recentMatches.slice(0, 8).map((match) =>
      match.homeClub + " " + (match.homeScore ?? "—") + "-" + (match.awayScore ?? "—") + " " + match.awayClub + " · " + new Date(match.date).toLocaleDateString("fa-IR"));
    await ctx.reply("مقایسه باشگاه‌ها\n\n" + lines.join("\n\n") + "\n\nرودررو: " + result.headToHead.totalMatches + " مسابقه\n" + (recent.join("\n") || "بدون مسابقه ثبت‌شده."));
  } catch (error) { await ctx.reply("مقایسه باشگاه‌ها ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.command("clubprofile", async (ctx) => {
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("استفاده: /clubprofile CLUB_ID");
  try {
    const profile = await publicApi<{ club: { id: string; name: string; level: number; reputation: number; logoUrl: string | null }; stats: { seasons: number; appearances: number; championships: number; podiums: number; promotions: number; relegations: number }; tiers: Array<{ tierName: string; appearances: number; championships: number }>; leagues: Array<{ season: number; tierName: string; groupNumber: number; finalPosition: number | null; awards: Array<{ awardName: string }> }> }>("/v1/clubs/" + encodeURIComponent(id) + "/profile");
    const s = profile.stats;
    const caption = profile.club.name + "\nسطح باشگاه: " + profile.club.level + " · اعتبار: " + profile.club.reputation +
      "\nفصل‌ها: " + s.seasons + " · قهرمانی: " + s.championships + " · سکو: " + s.podiums +
      "\nصعود: " + s.promotions + " · سقوط: " + s.relegations +
      "\n\n" + profile.leagues.slice(0, 8).map((row) => "فصل " + row.season + " · " + row.tierName + " · گروه " + row.groupNumber + " · رتبه " + (row.finalPosition ?? "—") + (row.awards.length ? " · " + row.awards.map((award) => award.awardName).join("، ") : "")).join("\n");
    const logoLink = profile.club.logoUrl && apiUrl ? "\n\nلوگوی باشگاه: " + new URL(profile.club.logoUrl, apiUrl).toString() : "";
    await ctx.reply((caption + logoLink).slice(0, 4096) || "پروفایل باشگاه خالی است.");
  } catch (error) { await ctx.reply("دریافت پروفایل باشگاه ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص")); }
});

bot.on("message:text", async (ctx, next) => {
  if (ctx.from && ctx.chat.type === "private" && ctx.message.reply_to_message) {
    const wizard = pendingEventTournamentWizards.get(ctx.from.id);
    if (wizard && wizard.promptMessageId === ctx.message.reply_to_message.message_id) {
      const value = ctx.message.text.trim();
      const ask = async (promptText: string) => {
        const prompt = await ctx.reply(promptText);
        wizard.promptMessageId = prompt.message_id;
      };
      if (wizard.stage === "title") {
        if (value.length < 3 || value.length > 100) return ask("عنوان باید بین ۳ تا ۱۰۰ نویسه باشد. دوباره ارسال کن.");
        wizard.title = value; wizard.stage = "description";
        return ask("توضیحات تورنمنت را ارسال کن (۵ تا ۲۰۰۰ نویسه).");
      }
      if (wizard.stage === "description") {
        if (value.length < 5 || value.length > 2000) return ask("توضیحات باید بین ۵ تا ۲۰۰۰ نویسه باشد. دوباره ارسال کن.");
        wizard.description = value; wizard.stage = "registrationDays";
        return ask("ثبت‌نام چند روز باز بماند؟ عددی بین ۱ تا ۶۰ ارسال کن.");
      }
      if (wizard.stage === "registrationDays") {
        const days = Number(value);
        if (!Number.isInteger(days) || days < 1 || days > 60) return ask("مدت ثبت‌نام باید عددی بین ۱ تا ۶۰ روز باشد.");
        wizard.registrationDays = days; wizard.stage = "startsInDays";
        return ask("تورنمنت چند روز دیگر شروع شود؟ باید بیشتر از مدت ثبت‌نام و حداکثر ۹۰ روز باشد.");
      }
      if (wizard.stage === "startsInDays") {
        const days = Number(value);
        if (!Number.isInteger(days) || days <= (wizard.registrationDays ?? 0) || days > 90) return ask("زمان شروع باید بیشتر از مدت ثبت‌نام و حداکثر ۹۰ روز باشد.");
        wizard.startsInDays = days; wizard.stage = "maxParticipants";
        return ask("حداکثر تعداد شرکت‌کنندگان را بین ۲ تا ۵۰۰ وارد کن.");
      }
      if (wizard.stage === "maxParticipants") {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 2 || count > 500) return ask("ظرفیت باید عددی بین ۲ تا ۵۰۰ باشد.");
        wizard.maxParticipants = count;
        const prompt = await ctx.reply("ورودی تورنمنت را انتخاب کن:", { reply_markup: new InlineKeyboard()
          .text("رایگان", "event-tournament:fee:FREE").row()
          .text("کش", "event-tournament:fee:CASH").text("طلا", "event-tournament:fee:GOLD").text("Honor", "event-tournament:fee:HONOR") });
        wizard.promptMessageId = prompt.message_id;
        return;
      }
      if (wizard.stage === "feeAmount") {
        if (!/^[1-9][0-9]{0,17}$/.test(value)) return ask("مبلغ ورودی باید عدد صحیح مثبت باشد.");
        wizard.feeAmount = value;
        await askTournamentPrize(ctx, wizard);
        return;
      }
      if (wizard.stage === "prizeAmount") {
        if (!/^[1-9][0-9]{0,17}$/.test(value)) return ask("مبلغ جایزه باید عدد صحیح مثبت باشد.");
        const placement = tournamentPlacements[wizard.placementIndex]!;
        wizard.prizes.push({ placement, type: wizard.pendingPrizeType!, amount: value });
        wizard.pendingPrizeType = undefined; wizard.placementIndex += 1;
        await askTournamentPrize(ctx, wizard);
        return;
      }
      if (wizard.stage === "itemKey") {
        if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(value)) return ask("کلید آیتم معتبر نیست؛ فقط حروف، عدد، خط تیره و زیرخط مجاز است.");
        wizard.prizes.push({ placement: tournamentPlacements[wizard.placementIndex]!, type: "STORE_ITEM", itemKey: value });
        wizard.placementIndex += 1; wizard.pendingPrizeType = undefined;
        await askTournamentPrize(ctx, wizard);
        return;
      }
      if (wizard.stage === "specialPlayerId") {
        if (value.length < 1 || value.length > 128) return ask("شناسه بازیکن ویژه معتبر نیست.");
        wizard.prizes.push({ placement: tournamentPlacements[wizard.placementIndex]!, type: "SPECIAL_PLAYER", specialPlayerId: value });
        wizard.placementIndex += 1; wizard.pendingPrizeType = undefined;
        await askTournamentPrize(ctx, wizard);
        return;
      }
    }
  }
  if (!ctx.from || !ctx.message.reply_to_message) return next();
  const groupPending = pendingGroupCreations.get(ctx.from.id);
  if ((ctx.chat.type === "group" || ctx.chat.type === "supergroup") && groupPending
    && groupPending.chatId === ctx.chat.id
    && groupPending.promptMessageId === ctx.message.reply_to_message.message_id) {
    pendingGroupCreations.delete(ctx.from.id);
    if (groupPending.expiresAt < Date.now()) return ctx.reply("مهلت ساخت به پایان رسید. دوباره از منوی Football Empire اقدام کن.");
    const title = ctx.message.text.trim();
    if (title.length < 3 || title.length > (groupPending.kind === "league" ? 40 : 80)) {
      return ctx.reply("عنوان باید بین ۳ تا " + (groupPending.kind === "league" ? "۴۰" : "۸۰") + " نویسه باشد.");
    }
    try {
      if (groupPending.kind === "challenge") {
        const now = new Date();
        const result = await api<{challenge:{id:string;title:string}}>(
          `/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges`, ctx.from.id, "POST",
          { title, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(), rewardPoints: "0", idempotencyKey: "group-challenge:" + randomUUID() },
        );
        await awardGroupActivity(ctx, "CHALLENGE_CREATE", result.challenge.id);
        await ctx.reply("🎯 چالش گروهی «" + result.challenge.title + "» ساخته شد. اعضا از دکمه «چالش‌های گروه» می‌توانند وارد شوند.", { reply_markup: groupStartKeyboard() });
      } else {
        const result = await api<{competition:{id:string;name:string}}>(
          `/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues`, ctx.from.id, "POST",
          { name: title, maxTeams: 8, idempotencyKey: "group-league:" + randomUUID() },
        );
        await awardGroupActivity(ctx, "LEAGUE_CREATE", result.competition.id);
        await ctx.reply("🏆 لیگ گروهی «" + result.competition.name + "» با ظرفیت ۸ تیم ساخته شد. اعضا از دکمه «لیگ‌های گروه» می‌توانند ثبت‌نام کنند.", { reply_markup: groupStartKeyboard() });
      }
    } catch (error) {
      await ctx.reply("ساخت موردنظر ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
    }
    return;
  }
  if (ctx.chat.type !== "private") return next();
  const pending = pendingClubNameEdits.get(ctx.from.id);
  if (!pending || pending.promptMessageId !== ctx.message.reply_to_message.message_id) return next();
  pendingClubNameEdits.delete(ctx.from.id);
  if (pending.expiresAt < Date.now()) return ctx.reply("مهلت ویرایش نام به پایان رسید. دوباره از منوی ویرایش باشگاه اقدام کن.");
  const name = ctx.message.text.trim();
  if (name.length < 2 || name.length > 32) return ctx.reply("نام باشگاه باید بین ۲ تا ۳۲ نویسه باشد. دوباره از گزینه ویرایش نام استفاده کن.");
  try {
    const result = await api<{club:{name:string}}>("/v1/club", ctx.from.id, "PATCH", { name });
    await replyRich(ctx, "✅ نام باشگاه به <b>" + escapeHtml(result.club.name) + "</b> تغییر کرد.", "نام باشگاه با موفقیت به «" + result.club.name + "» تغییر کرد.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای نامشخص";
    await ctx.reply(message.includes("CLUB_EDIT_LOCKED_ACTIVE_LEAGUE")
      ? "🔒 تغییر نام مجاز نیست؛ باشگاه در یک لیگ فعال حضور دارد."
      : "تغییر نام باشگاه ناموفق بود: " + message);
  }
});

bot.on(["chat_member","my_chat_member"],async ctx=>{
 if(ctx.chat.type!=="group"&&ctx.chat.type!=="supergroup")return;
 const botChange="my_chat_member" in ctx.update?ctx.update.my_chat_member:null;
 const memberChange="chat_member" in ctx.update?ctx.update.chat_member:null;
 const botStatus=botChange?.new_chat_member.status;
 const botPresent=botStatus?["creator","administrator"].includes(botStatus):undefined;
 try{
  let memberCount:number;
  try{memberCount=await ctx.api.getChatMemberCount(ctx.chat.id);}
  catch(error){if(botPresent===false)memberCount=0;else throw error;}
  await apiSystem("/v1/groups/system/member-count",{telegramGroupId:String(ctx.chat.id),memberCount,...(botPresent!==undefined?{botPresent}:{})});
  if(memberChange){
   const member=memberChange.new_chat_member;
   const isMember=member.status==="creator"||member.status==="administrator"||member.status==="member"||(member.status==="restricted"&&member.is_member);
   const role=member.status==="creator"?"OWNER":member.status==="administrator"?"ADMIN":"MEMBER";
   await apiSystem("/v1/groups/system/member-update",{telegramGroupId:String(ctx.chat.id),telegramUserId:String(member.user.id),isMember,role});
  }
 }catch(error){console.warn("Could not refresh Telegram group membership:",error instanceof Error?error.message:error);}
});

  async function runBackgroundJobs() {
    await pollGroupMessageDeletionQueue();
    await pollMatchCheckpointNotifications();
    await pollMatchResultNotifications();
    await pollLeagueNoticeQueue();
    await pollAdminGroupBroadcastQueue();
  }
  function setBotTelegramId(id: number) { botTelegramId = id; }
  return { bot, runBackgroundJobs, setBotTelegramId };
}
