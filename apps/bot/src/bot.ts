import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import {
  GROUP_REPLY_DELETE_DELAY_MS,
  isPersistentGroupReply,
  PRIVATE_MENU_ROWS,
  resolvePrivateMenuCommand,
} from "./telegram-ux.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required to start the bot.");
const webAppUrl = process.env.TELEGRAM_WEB_APP_URL;
const apiUrl = process.env.FOOTBALL_API_URL;
const botApiSecret = process.env.BOT_API_SECRET;
const bot = new Bot(token);

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
    const command = ctx.message?.text?.match(/^\/([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
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
  const response = await fetch(new URL(path, apiUrl), {
    method,
    headers: {
      "content-type": "application/json",
      "x-football-bot-secret": botApiSecret,
      "x-telegram-user-id": String(telegramId),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json() as T & { error?: string; details?: Record<string, string> };
  if (!response.ok) {
    const range = data.details?.minimumWeeklyWage ? ` (acceptable weekly wage: ${cash(data.details.minimumWeeklyWage)}–${cash(data.details.maximumWeeklyWage ?? data.details.minimumWeeklyWage)} Cash)` : "";
    throw new Error((data.error ?? `API request failed (${response.status})`) + range);
  }
  return data;
}


async function publicApi<T>(path: string): Promise<T> {
  if (!apiUrl) throw new Error("FOOTBALL_API_URL is not configured.");
  const response = await fetch(new URL(path, apiUrl));
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Public API request failed.");
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
    const downloaded = await fetch("https://api.telegram.org/file/bot" + token + "/" + telegramFile.file_path);
    if (!downloaded.ok) throw new Error("TELEGRAM_FILE_DOWNLOAD_FAILED");
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    if (bytes.length > 512 * 1024) throw new Error("LOGO_TOO_LARGE");
    await api("/v1/club/logo", ctx.from.id, "PUT", { mimeType, base64: bytes.toString("base64") });
    await ctx.reply("لوگوی باشگاه با موفقیت به‌روزرسانی شد.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای نامشخص";
    await ctx.reply(message === "LOGO_TOO_LARGE" ? "حجم لوگو بیشتر از ۵۱۲ کیلوبایت است." : "ثبت لوگو ناموفق بود: " + message);
  }
}

async function awardGroupActivity(ctx: { chat: { type: string; id: number }; from: { id: number } | undefined }, activityType: "CHALLENGE_JOIN"|"CHALLENGE_CREATE"|"LEAGUE_JOIN"|"LEAGUE_CREATE"|"MATCH_PLAYED", referenceId: string) {
 if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;
 try{await api(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/activity/award`,ctx.from.id,"POST",{activityType,referenceId});}
 catch(error){console.warn("Group activity reward skipped:",error instanceof Error?error.message:error);}
}
async function apiSystem<T = unknown>(path:string,body:unknown):Promise<T>{
 if(!apiUrl||!botApiSecret)throw new Error("Bot API is not configured.");
 const response=await fetch(new URL(path,apiUrl),{method:"POST",headers:{"content-type":"application/json","x-football-bot-secret":botApiSecret},body:JSON.stringify(body)});
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
    console.warn("Could not persist group message deletion; using in-memory fallback:", error instanceof Error ? error.message : error);
    const delay = Math.max(0, deleteAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      void bot.api.deleteMessage(chatId, messageId).catch((deleteError: unknown) => {
        console.debug("Fallback group message deletion failed:", deleteError instanceof Error ? deleteError.message : deleteError);
      });
    }, delay);
    timer.unref();
  }
}


type LeagueNoticeDelivery = { id: string; telegramId: string; title: string; body: string; claimToken: string };
let leagueNoticeWorkerBusy = false;
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
          + "\nدقیقه " + notification.minute + " · مهلت تا " + new Date(notification.deadlineAt).toLocaleTimeString("fa-IR")
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

function privateMenuKeyboard() {
  const keyboard = new Keyboard();
  for (const row of PRIVATE_MENU_ROWS) {
    for (const item of row) keyboard.text(item.label);
    keyboard.row();
  }
  if (webAppUrl) keyboard.webApp("ورود به بازی", webAppUrl);
  return keyboard.resized().persistent();
}
function cash(value: string) { return BigInt(value).toLocaleString("en-US"); }
function playerName(player: ApiPlayer) { return `${player.firstName} ${player.lastName}`; }

bot.command("start", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") {
    return ctx.reply("To create or open your Football Empire club, start a private chat with me.");
  }

  try {
    const account = await api<{
      user: { displayName: string };
      club: { name: string; level: number } | null;
      wallets: Array<{ asset: "CASH" | "GOLD"; balance: string }>;
    }>("/v1/auth/bot", ctx.from.id, "POST", {
      firstName: ctx.from.first_name,
      ...(ctx.from.last_name ? { lastName: ctx.from.last_name } : {}),
      ...(ctx.from.username ? { username: ctx.from.username } : {}),
    });

    const startPayload = String(ctx.match ?? "").trim();
    if (startPayload.startsWith("challenge_")) {
      const tokenValue = startPayload.slice("challenge_".length);
      try {
        const accepted = await api<{ match: { id: string; scheduledAt: string } }>(
          `/v1/friendly-challenges/${encodeURIComponent(tokenValue)}/accept`, ctx.from.id, "POST", {},
        );
        await ctx.reply("چالش دوستانه پذیرفته شد. مسابقه با شناسه " + accepted.match.id
          + " ثبت شد و تا " + new Date(accepted.match.scheduledAt).toLocaleString("fa-IR") + " آغاز می‌شود.");
        return;
      } catch (error) {
        await ctx.reply("پذیرش چالش ناموفق بود: " + (error instanceof Error ? error.message : "خطای نامشخص"));
      }
    }

    const cashBalance = account.wallets.find((wallet) => wallet.asset === "CASH")?.balance ?? "0";
    const goldBalance = account.wallets.find((wallet) => wallet.asset === "GOLD")?.balance ?? "0";
    const keyboard = privateMenuKeyboard();

    await ctx.reply(
      `Welcome, ${account.user.displayName}! Your club is ready.\n\n` +
      `Club: ${account.club?.name ?? "Not created"} (Level ${account.club?.level ?? 1})\n` +
      `Starter balance: ${cash(cashBalance)} Cash · ${cash(goldBalance)} Gold\n\n` +
      `You can manage your club directly here or continue in the Mini App.\n\n` +
      `Commands: /club /wallet /rename /players /lineup /development /train /renew /market /special /pack /sell /buy /records /menu`,
      { reply_markup: keyboard },
    );
  } catch (error) {
    await ctx.reply(`Could not create or load your club: ${error instanceof Error ? error.message : "unknown error"}`);
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

const adminOnlyInPrivate = (ctx: Context) => ctx.chat.type === "private";

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
    await ctx.reply("پنل مدیریت Football Empire\n\n" + rows.join("\n") + "\n\nبرای فهرست‌ها: /adminlist RESOURCE [QUERY]\nراهنما: /adminhelp");
  } catch (error) {
    await ctx.reply("دسترسی مدیریت تأیید نشد یا سرویس در دسترس نیست: " + (error instanceof Error ? error.message : "خطای نامشخص"));
  }
});

bot.command("adminlist", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  const [resource, ...queryParts] = String(ctx.match ?? "").trim().split(/\s+/);
  const allowed = new Set(["players", "clubs", "users", "groups", "challenges", "leagues", "items", "gift-codes", "alliances", "matches", "alliance-seasons", "wallet-ledger", "group-ledger", "audit"]);
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
    await ctx.reply("وضعیت گروه با موفقیت به‌روزرسانی شد.");
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

bot.command("adminhelp", async (ctx) => {
  if (!ctx.from || !adminOnlyInPrivate(ctx)) return;
  await ctx.reply(
    "راهنمای پنل مدیریت ربات\n/admin — آمار کلی\n/adminlist RESOURCE [QUERY] — فهرست منابع\n" +
    "/adminuser suspend|restore USER_ID [REASON] — تعلیق/رفع تعلیق کاربر\n" +
    "/admingroup suspend|restore GROUP_ID [REASON] — تعلیق/رفع تعلیق گروه\n" +
    "/adminchallenge cancel CHALLENGE_ID — لغو چالش\n\n" +
    "تمام درخواست‌ها در API با نقش و مجوز مدیر بررسی و در گزارش مدیریتی ثبت می‌شوند. این دستورات فقط در گفت‌وگوی خصوصی فعال‌اند."
  );
});

bot.command("menu", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  await ctx.reply("منوی اصلی Football Empire آماده است. برای عملیات دارای ورودی، از /help راهنمای دستورها را ببینید.", {
    reply_markup: privateMenuKeyboard(),
  });
});

bot.command("help", async (ctx) => ctx.reply(
  "Football Empire commands:\n/menu — show the private Reply Keyboard again\n/club — club profile\n/wallet — Cash and Gold balances\n/rename NEW NAME — rename your club\n/players — your active squad\n/lineup — view starting XI and tactics\n/setlineup FORMATION ID1 ... ID11 — set your XI\n/development — player development overview\n/train PLAYER_ID FOCUS INTENSITY — train a player\n/renew PLAYER_ID DAYS WEEKLY_WAGE — renew a contract\n/operations — facilities, academy, sponsors and finance\n/finance [DAYS] — income and expense statement\n/upgrade stadium|training|academy — upgrade a facility\n/ticket-price PRICE — set stadium ticket price\n/scout — find academy prospects\n/recruit PROSPECT_ID — sign an academy prospect\n/sponsor OFFER_ID — sign a sponsor\n/coach-upgrade — develop your coach\n/hire-coach balanced|youth|performance — hire a coach\n/opponents — clubs available for friendlies\n/friendly CLUB_ID — schedule a friendly\n/challenge — create a shareable friendly challenge (3 free + 2 Gold/day)\n/acceptchallenge TOKEN — accept a shared challenge\n/matches — fixtures, live status and quick tactical buttons\n/tactic MATCH_ID minute-45 mentality=ATTACKING pressing=HIGH_PRESS tempo=FAST passingStyle=DIRECT formation=4-3-3\n/sub MATCH_ID minute-45 OUT_ID IN_ID [OUT_ID IN_ID ...] — make up to five substitutions\n/play MATCH_ID — simulate a due match\n/league NAME [4-10] — create a league\n/cup NAME [4|8] [legs=1|2] — create a single- or two-legged knockout cup\n/leagues — open leagues\n/joinleague ID — join a league\n/startleague ID — start your league\n/startcup ID — start your cup\n/table ID — league table or cup bracket\n/pyramidleagues — national league pyramid\n/pyramidtable LEAGUE_ID — table, scorers, assists and awards\n/records [goals|assists|appearances|rating] — all-time player records\n/seasonawards [YEAR] — seasonal awards and team of the season\n/leagueapply — apply for the base league\n/promotion OFFER_ID accept|decline — respond to promotion\n/leaguenotices — view promotion and league notices\n/competitionrules ID [subs=5 windows=3 injuries=on injurydays=5 red=1 yellow=3 yellowban=1 penalties=on] — configure competition rules before kickoff\n/group-register — register this Telegram group (admins only)\n/group-join — join this group with your club\n/group — show group status and treasury\n/group-activity — earn one daily group point\n/group-shop — reward shop\n/group-buy ITEM [USER_ID] — purchase reward\n/group-challenges — list challenges\n/group-challenge TITLE|START_ISO|END_ISO|POINTS — create challenge\n/group-challenge-join ID — join challenge\n/group-challenge-complete ID USER_ID — settle challenge\n/group-check — refresh member threshold\n/group-league NAME [4-10] — create local league\n/group-league-join ID — join local league\n/group-league-start ID — start local league\n/group-league-table ID — standings\n/alliance — alliance status and invitations\n/alliance-create NAME — create an alliance\n/alliance-invite GROUP_ID — invite a group\n/alliance-contribute AMOUNT — contribute group points to alliance treasury\n/alliance-accept ID / /alliance-decline ID — respond to invite\n/alliance-championship NAME|TEAMS — cross-group tournament\n/alliance-championship-join ID / alliance-championship-start ID\n/alliance-season-start [DAYS] / alliance-season-close\n/alliance-season-review SEASON_ID approve|reject — flagged prize review (authorized reviewer)\n/market — open transfer listings\n/sell PLAYER_ID PRICE — list a generated player\n/buy LISTING_ID — buy a listed player\n/special — view special players and pack prices\n/pack epic|legendary|icon — acquire a special player\n\nSpecial players are not tradeable in the regular market.",
));

bot.command("group-cleanup-test", async (ctx) => {
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return;
  await ctx.reply("پیام آزمایشی حذف خودکار Football Empire است. اگر صف حذف فعال باشد، این پیام حدود ۶۰ ثانیه دیگر حذف می‌شود.");
});

bot.command("group-register", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return ctx.reply("Run /group-register inside the Telegram group you want to register.");
  try {
    const memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
    if (memberCount < 10) return ctx.reply("This group needs at least 10 Telegram members to activate Football Empire. Current members: " + memberCount + ".");
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    const role = member.status === "creator" ? "OWNER" : member.status === "administrator" ? "ADMIN" : null;
    if (!role) return ctx.reply("Only a group owner or administrator can register this group.");
    const result = await api<{ registration: { group: { title: string; memberCount: number; isActive: boolean; points: string }; role: string; registeredManagers: number; minimumMembers: number } }>("/v1/groups/register", ctx.from.id, "POST", { telegramGroupId: String(ctx.chat.id), title: ctx.chat.title, role, memberCount });
    await ctx.reply("Football Empire group connected: " + result.registration.group.title + "\nRegistered role: " + result.registration.role + "\nRegistered club managers: " + result.registration.registeredManagers + "\n\nMembers can join with /group-join after starting the Bot privately.");
  } catch (error) { await ctx.reply("Could not register this group: " + (error instanceof Error ? error.message : "unknown error")); }
});

bot.command("group-join", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return ctx.reply("Run /group-join inside a registered Telegram group.");
  try {
    const memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
    if (memberCount < 10) return ctx.reply("This group currently has fewer than 10 Telegram members and is inactive.");
    const result = await api<{ membership: { group: { title: string }; role: string; registeredManagers: number; memberCount: number; alreadyJoined: boolean } }>("/v1/groups/join", ctx.from.id, "POST", { telegramGroupId: String(ctx.chat.id), memberCount });
    await ctx.reply(result.membership.alreadyJoined ? "Your club is already registered in " + result.membership.group.title + ". Role: " + result.membership.role + "." : "Your club joined " + result.membership.group.title + ". Registered club managers: " + result.membership.registeredManagers + ".");
  } catch (error) { await ctx.reply("Could not join this group: " + (error instanceof Error ? error.message : "unknown error")); }
});

bot.command("group", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return ctx.reply("Use /group inside a registered Telegram group.");
  try {
    const result = await api<{ group: { title: string; memberCount: number; isActive: boolean; points: string }; role: string; registeredManagers: number; minimumMembers: number }>("/v1/groups/" + encodeURIComponent(String(ctx.chat.id)), ctx.from.id);
    await ctx.reply("Football Empire · " + result.group.title + "\nStatus: " + (result.group.isActive ? "ACTIVE" : "INACTIVE") + "\nTelegram members: " + result.group.memberCount + "\nRegistered club managers: " + result.registeredManagers + "\nGroup points: " + result.group.points + "\nMinimum members: " + result.minimumMembers);
  } catch (error) { await ctx.reply("Group status unavailable: " + (error instanceof Error ? error.message : "unknown error") + "\nUse /group-register (admins) or /group-join (members)."); }
});
bot.command("group-activity", async (ctx) => {
  if (!ctx.from || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return;
  try {
    const result = await api<{ activity: { awarded: boolean; replayed: boolean; points: string; award: string } }>("/v1/groups/activity", ctx.from.id, "POST", { telegramGroupId: String(ctx.chat.id) });
    await ctx.reply(result.activity.awarded ? "Daily group activity recorded. +1 group point. Treasury: " + result.activity.points : "Your activity was already counted today. Group treasury: " + result.activity.points);
  } catch (error) { await ctx.reply("Could not record group activity: " + (error instanceof Error ? error.message : "unknown error")); }
});

bot.command("group-shop",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;try{const d=await api<{points:string;items:Array<{slug:string;name:string;cost:string;scope:string}>}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/shop`,ctx.from.id);await ctx.reply("Treasury: "+cash(d.points)+" points\n"+d.items.map(i=>i.slug+" — "+i.name+" "+cash(i.cost)+" ["+i.scope+"]").join("\n"));}catch(e){await ctx.reply("Shop unavailable: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-buy",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const [itemSlug,recipientTelegramId]=String(ctx.match??"").trim().split(/\s+/);if(!itemSlug)return ctx.reply("Usage: /group-buy ITEM [USER_ID]");try{const d=await api<{item:string;points:string}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/shop/purchase`,ctx.from.id,"POST",{itemSlug,...(recipientTelegramId?{recipientTelegramId}:{}),idempotencyKey:"group-buy:"+randomUUID()});await ctx.reply("Purchased "+d.item+" · treasury "+cash(d.points));}catch(e){await ctx.reply("Purchase failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenges",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;try{const d=await api<{challenges:Array<{id:string;title:string;status:string;participants:number;rewardPoints:string}>}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges`,ctx.from.id);await ctx.reply(d.challenges.length?d.challenges.map(c=>c.id+" "+c.title+" ["+c.status+"] · "+c.participants+" participants · "+cash(c.rewardPoints)+" points").join("\n"):"No challenges.");}catch(e){await ctx.reply("Challenges unavailable: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenge",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const [title,startsAt,endsAt,rewardPoints]=String(ctx.match??"").split("|").map(x=>x.trim());if(!title||!startsAt||!endsAt||!rewardPoints)return ctx.reply("Usage: /group-challenge TITLE|START_ISO|END_ISO|POINTS");try{const d=await api<{challenge:{id:string}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges`,ctx.from.id,"POST",{title,startsAt,endsAt,rewardPoints,idempotencyKey:"group-challenge:"+randomUUID()});await awardGroupActivity(ctx,"CHALLENGE_CREATE",d.challenge.id);await ctx.reply("Created: "+d.challenge.id+" · join /group-challenge-join "+d.challenge.id);}catch(e){await ctx.reply("Create failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenge-join",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-challenge-join ID");try{await api(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges/${encodeURIComponent(id)}/join`,ctx.from.id,"POST",{});await awardGroupActivity(ctx,"CHALLENGE_JOIN",id);await ctx.reply("Joined challenge.");}catch(e){await ctx.reply("Join failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenge-complete",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const [id,winnerTelegramId]=String(ctx.match??"").trim().split(/\s+/);if(!id||!winnerTelegramId)return ctx.reply("Usage: /group-challenge-complete ID WINNER_USER_ID");try{await api(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges/${encodeURIComponent(id)}/complete`,ctx.from.id,"POST",{winnerTelegramId});await ctx.reply("Challenge settled.");}catch(e){await ctx.reply("Settle failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-check",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;try{const m=await ctx.api.getChatMember(ctx.chat.id,ctx.from.id);if(m.status!=="creator"&&m.status!=="administrator")return ctx.reply("Admins only.");const memberCount=await ctx.api.getChatMemberCount(ctx.chat.id);const d=await api<{isActive:boolean;memberCount:number}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/check`,ctx.from.id,"POST",{memberCount});await ctx.reply("Group "+(d.isActive?"ACTIVE":"INACTIVE")+" · "+d.memberCount+" members.");}catch(e){await ctx.reply("Check failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-league",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const m=String(ctx.match??"").trim().match(/^(.*?)(?:\s+(\\d+))?$/),name=m?.[1]?.trim(),maxTeams=Number(m?.[2]??8);if(!name||maxTeams<4||maxTeams>10)return ctx.reply("Usage: /group-league NAME [4-10]");try{const d=await api<{competition:{id:string}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues`,ctx.from.id,"POST",{name,maxTeams,idempotencyKey:"group-league:"+randomUUID()});await awardGroupActivity(ctx,"LEAGUE_CREATE",d.competition.id);await ctx.reply("League: "+d.competition.id+" · join /group-league-join "+d.competition.id);}catch(e){await ctx.reply("Create failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-league-join",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-league-join ID");try{const d=await api<{teams:number}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues/${encodeURIComponent(id)}/join`,ctx.from.id,"POST",{});await awardGroupActivity(ctx,"LEAGUE_JOIN",id);await ctx.reply("Joined · teams "+d.teams);}catch(e){await ctx.reply("Join failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-league-start",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-league-start ID");try{const d=await api<{fixturesCreated:number;rounds:number}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues/${encodeURIComponent(id)}/start`,ctx.from.id,"POST",{});await ctx.reply("Started · fixtures "+d.fixturesCreated+" · rounds "+d.rounds);}catch(e){await ctx.reply("Start failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-league-table",async ctx=>{if(!ctx.from||!["group","supergroup"].includes(ctx.chat.type))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-league-table ID");try{const d=await api<{competition:{name:string;teams:Array<{rank:number;club:string;points:number;played:number}>}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues/${encodeURIComponent(id)}`,ctx.from.id);await ctx.reply(d.competition.name+"\n"+d.competition.teams.map(t=>t.rank+". "+t.club+" · "+t.points+" pts · "+t.played+" P").join("\n"));}catch(e){await ctx.reply("Table failed: "+(e instanceof Error?e.message:"unknown"));}});


bot.command("group-rewards",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;try{const d=await api<{personal:{points:string;rewards:Array<{item:string;grantedAt:string}>}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/workspace`,ctx.from.id);await ctx.reply("Personal group points: "+cash(d.personal.points)+"\n"+(d.personal.rewards.map(r=>r.item+" · "+new Date(r.grantedAt).toLocaleDateString()).join("\n")||"No rewards yet."));}catch(e){await ctx.reply("Rewards unavailable: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-treasury",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;try{const d=await api<{group:{points:string;memberCount:number;isActive:boolean};personal:{history:Array<{amount:string;description:string}>}}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/workspace`,ctx.from.id);await ctx.reply("Treasury: "+cash(d.group.points)+" points · "+d.group.memberCount+" members · "+(d.group.isActive?"active":"inactive")+"\n"+d.personal.history.slice(0,6).map(x=>(BigInt(x.amount)>=0n?"+":"")+cash(x.amount)+" · "+x.description).join("\n"));}catch(e){await ctx.reply("Treasury unavailable: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-give",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;const [recipientTelegramId,itemSlug]=String(ctx.match??"").trim().split(/\s+/);if(!recipientTelegramId||!itemSlug)return ctx.reply("Usage: /group-give USER_ID ITEM_SLUG");try{const d=await api<{item:string;points:string}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/shop/purchase`,ctx.from.id,"POST",{itemSlug,recipientTelegramId,idempotencyKey:"group-give:"+randomUUID()});await ctx.reply("Granted "+d.item+" · treasury "+cash(d.points));}catch(e){await ctx.reply("Grant failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-challenge-cancel",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;const id=String(ctx.match??"").trim();if(!id)return ctx.reply("Usage: /group-challenge-cancel ID");try{const d=await api<{replayed:boolean;points:string}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/challenges/${encodeURIComponent(id)}/cancel`,ctx.from.id,"POST",{});await ctx.reply("Challenge cancelled. Treasury: "+cash(d.points)+" points.");}catch(e){await ctx.reply("Cancel failed: "+(e instanceof Error?e.message:"unknown"));}});
bot.command("group-leagues",async ctx=>{if(!ctx.from||!(ctx.chat.type==="group"||ctx.chat.type==="supergroup"))return;try{const d=await api<{leagues:Array<{id:string;name:string;status:string;teams:number;maxTeams:number}>}>(`/v1/groups/${encodeURIComponent(String(ctx.chat.id))}/leagues`,ctx.from.id);await ctx.reply(d.leagues.length?d.leagues.map(c=>c.name+" ["+c.status+"] "+c.teams+"/"+c.maxTeams+" · "+c.id).join("\n"):"No local leagues.");}catch(e){await ctx.reply("Leagues unavailable: "+(e instanceof Error?e.message:"unknown"));}});

bot.command("club", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /club in a private chat to view your club.");
  try {
    const result = await api<{
      club: { name: string; level: number; reputation: number; createdAt: string } | null;
      user: { displayName: string };
    }>("/v1/me", ctx.from.id);
    if (!result.club) return ctx.reply("You do not have a club yet. Send /start to create one.");
    await ctx.reply(
      `Club: ${result.club.name}\nManager: ${result.user.displayName}\nLevel: ${result.club.level}\nReputation: ${result.club.reputation}\nFounded: ${new Date(result.club.createdAt).toLocaleDateString("en-US")}`,
    );
  } catch (error) {
    await ctx.reply(`Could not load club: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("wallet", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /wallet in a private chat to view your balances.");
  try {
    const result = await api<{ wallets: Array<{ asset: "CASH" | "GOLD"; balance: string }> }>("/v1/wallet", ctx.from.id);
    const balances = result.wallets.map((wallet) => `${wallet.asset}: ${cash(wallet.balance)}`).join("\n");
    await ctx.reply(`Your club wallet:\n${balances || "No wallet balances found."}`);
  } catch (error) {
    await ctx.reply(`Could not load wallet: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("rename", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /rename in a private chat to rename your club.");
  const name = String(ctx.match ?? "").trim();
  if (name.length < 2 || name.length > 32) return ctx.reply("Usage: /rename NEW CLUB NAME (2–32 characters)");
  try {
    const result = await api<{ club: { name: string } }>("/v1/club", ctx.from.id, "PATCH", { name });
    await ctx.reply(`Your club is now called ${result.club.name}.`);
  } catch (error) {
    await ctx.reply(`Could not rename club: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("players", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /players in a private chat to view your squad.");
  try {
    await api("/v1/club/development", ctx.from.id);
    const result = await api<{ players: ApiPlayer[] }>("/v1/club/players", ctx.from.id);
    if (!result.players.length) return ctx.reply("Your squad is empty. Open the Mini App to complete club setup.");
    const lines = result.players.map((p) => `• ${playerName(p)} | ${p.position} | OVR ${p.overall} | POT ${p.potential}${p.lineupSlot ? ` | XI #${p.lineupSlot}` : ""}\n  Fitness ${p.fitness ?? "-"} · Morale ${p.morale ?? "-"} · Contract ${p.contractDays ?? "-"}d · Wage ${p.wage ? cash(p.wage) : "-"} / week · ${p.status ?? "ACTIVE"}\n  ID: ${p.id}`);
    await ctx.reply("Your active squad:\n\n" + lines.join("\n"));
  } catch (error) { await ctx.reply(`Could not load squad: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("lineup", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /lineup in a private chat to view your starting XI.");
  try {
    await api("/v1/club/development", ctx.from.id);
    const result = await api<{ club: {
      formation: string;
      tactics: { mentality: string; pressing: string; tempo: string; passingStyle: string };
      lineupVersion: number;
      players: Array<{ id: string; firstName: string; lastName: string; position: string; overall: number; lineupSlot: number }>;
    } }>("/v1/club/lineup", ctx.from.id);
    const players = result.club.players.map((player) => `${player.lineupSlot}. ${player.firstName} ${player.lastName} — ${player.position} · OVR ${player.overall}`);
    await ctx.reply(
      `Formation: ${result.club.formation} · Version: ${result.club.lineupVersion}\n` +
      `Tactics: ${result.club.tactics.mentality}, ${result.club.tactics.pressing}, ${result.club.tactics.tempo}, ${result.club.tactics.passingStyle}\n\n` +
      (players.join("\n") || "No starting XI configured.") +
      "\n\nUse /players to find IDs, then /setlineup FORMATION ID1 ... ID11.\nFormations: 4-3-3, 4-4-2, 3-5-2, 4-2-3-1",
    );
  } catch (error) {
    await ctx.reply(`Could not load lineup: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("setlineup", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /setlineup in a private chat to change your starting XI.");
  const parts = String(ctx.match ?? "").trim().split(/\s+/);
  const [formation, ...playerIds] = parts;
  if (!formation || playerIds.length !== 11) {
    return ctx.reply("Usage: /setlineup 4-3-3 PLAYER_ID_1 ... PLAYER_ID_11\nSupported: 4-3-3, 4-4-2, 3-5-2, 4-2-3-1");
  }
  try {
    const current = await api<{ club: { lineupVersion: number } }>("/v1/club/lineup", ctx.from.id);
    await api("/v1/club/lineup", ctx.from.id, "PUT", {
      formation, playerIds, expectedVersion: current.club.lineupVersion,
    });
    await ctx.reply("Starting XI and formation saved. Use /lineup to review your setup.");
  } catch (error) {
    await ctx.reply(`Could not save lineup: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("development", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /development in a private chat.");
  try {
    const result = await api<{ club: {
      trainingGroundLevel: number;
      weeklyWageBill: string;
      wageArrears: string;
      coach: { name: string; level: number; trainingSkill: number; recoverySkill: number; medicalSkill: number; weeklySalary: string };
      players: Array<{ id: string; firstName: string; lastName: string; overall: number; potential: number; age: number; fitness: number; morale: number; contractDays: number; status: string; minimumWeeklyWage: string; maximumWeeklyWage: string }>;
    } }>("/v1/club/development", ctx.from.id);
    const lines = result.club.players.slice(0, 15).map((p) =>
      `• ${p.firstName} ${p.lastName} · OVR ${p.overall}/${p.potential} · Age ${p.age}\n  Fitness ${p.fitness} · Morale ${p.morale} · Contract ${p.contractDays}d · ${p.status}\n  Renew ${cash(p.minimumWeeklyWage)}–${cash(p.maximumWeeklyWage)} Cash/week\n  ID: ${p.id}`,
    );
    await ctx.reply(
      `Player development · Training ground Lv.${result.club.trainingGroundLevel}\nWeekly wage bill: ${cash(result.club.weeklyWageBill)} Cash · Arrears: ${cash(result.club.wageArrears)} Cash\nCoach: ${result.club.coach.name} (Lv.${result.club.coach.level})\nTraining ${result.club.coach.trainingSkill} · Recovery ${result.club.coach.recoverySkill} · Medical ${result.club.coach.medicalSkill} · Salary ${cash(result.club.coach.weeklySalary)} Cash/week\n\n` +
      (lines.join("\n\n") || "No players found.") +
      "\n\n/train PLAYER_ID BALANCED|SHOOTING|... LIGHT|NORMAL|INTENSE\n/renew PLAYER_ID 90|180|365 WEEKLY_WAGE",
    );
  } catch (error) { await ctx.reply(`Could not load player development: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("train", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /train in a private chat.");
  const [playerId, focusRaw, intensityRaw] = String(ctx.match ?? "").trim().split(/\s+/);
  const focus = focusRaw?.toUpperCase();
  const intensity = intensityRaw?.toUpperCase();
  const focuses = ["BALANCED", "GOALKEEPING", "DEFENDING", "PASSING", "PLAYMAKING", "DRIBBLING", "SHOOTING", "PHYSICAL"];
  if (!playerId || !focus || !focuses.includes(focus) || !["LIGHT", "NORMAL", "INTENSE"].includes(intensity ?? "")) {
    return ctx.reply("Usage: /train PLAYER_ID FOCUS INTENSITY\nFocus: BALANCED, GOALKEEPING, DEFENDING, PASSING, PLAYMAKING, DRIBBLING, SHOOTING, PHYSICAL\nIntensity: LIGHT, NORMAL, INTENSE");
  }
  try {
    const result = await api<{ training: { overallBefore: number; overallAfter: number; fitnessBefore: number; fitnessAfter: number; injuryOccurred: boolean; injuryUntil: string | null; cashCost: string; replayed: boolean } }>(
      `/v1/club/players/${encodeURIComponent(playerId)}/train`, ctx.from.id, "POST",
      { focus, intensity, idempotencyKey: `tg-train-${ctx.from.id}-${ctx.update.update_id}` },
    );
    const t = result.training;
    await ctx.reply(
      `Training complete. OVR ${t.overallBefore} → ${t.overallAfter}; fitness ${t.fitnessBefore} → ${t.fitnessAfter}. Cost: ${cash(t.cashCost)} Cash.` +
      (t.injuryOccurred ? `\nInjury: player unavailable until ${t.injuryUntil}.` : "") +
      (t.replayed ? "\nThis was a repeated request." : ""),
    );
  } catch (error) { await ctx.reply(`Training failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("renew", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /renew in a private chat.");
  const [playerId, daysRaw, wageRaw] = String(ctx.match ?? "").trim().split(/\s+/);
  const days = Number(daysRaw);
  if (!playerId || ![90, 180, 365].includes(days) || !wageRaw || !/^[1-9][0-9]{0,8}$/.test(wageRaw)) {
    return ctx.reply("Usage: /renew PLAYER_ID 90|180|365 WEEKLY_WAGE\nUse /development to see the minimum acceptable weekly wage.");
  }
  try {
    const result = await api<{ contract: { contractDays: number; weeklyWage: string; replayed: boolean } }>(
      `/v1/club/players/${encodeURIComponent(playerId)}/contract/renew`, ctx.from.id, "POST",
      { extensionDays: days, weeklyWage: wageRaw, idempotencyKey: `tg-renew-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(`Contract renewed: ${result.contract.contractDays} days remaining · ${cash(result.contract.weeklyWage)} Cash/week.${result.contract.replayed ? " This was a repeated request." : ""}`);
  } catch (error) { await ctx.reply(`Contract renewal failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("operations", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /operations in a private chat.");
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
    await ctx.reply(
      `Club facilities\nStadium Lv.${club.stadiumLevel} · ${club.stadiumCapacity} seats · Ticket ${cash(club.ticketPrice)} Cash\nTraining ground Lv.${club.trainingGroundLevel} · Academy Lv.${club.academyLevel}\nDaily maintenance: ${cash(club.dailyMaintenance)} Cash · Operating arrears: ${cash(club.operatingArrears)} Cash\nCoach: ${club.coach?.name ?? "None"} (Lv.${club.coach?.level ?? 0}) · Salary ${cash(club.coach?.weeklySalary ?? "0")} Cash/week\nSponsor: ${sponsor}\n\nAcademy prospects:\n${prospects.join("\n\n") || "No available prospects"}\n\n/upgrade stadium|training|academy\n/scout\n/recruit PROSPECT_ID\n/sponsor local-partner|regional-brand|national-network\n/coach-upgrade\n/hire-coach balanced|youth|performance`,
    );
  } catch (error) { await ctx.reply(`Could not load club operations: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("finance", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /finance in a private chat.");
  const daysRaw = String(ctx.match ?? "").trim();
  const days = daysRaw ? Number(daysRaw) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 90) return ctx.reply("Usage: /finance [DAYS 1-90]");
  try {
    const result = await api<{ periodDays: number; income: string; expenses: string; net: string; operatingArrears: string; entries: Array<{ category: string; direction: string; amount: string; description: string; occurredAt: string }> }>(`/v1/club/finance?days=${days}`, ctx.from.id);
    const entries = result.entries.slice(0, 12).map((entry) =>
      "• " + (entry.direction === "CREDIT" ? "+" : "−") + cash(entry.amount) + " Cash · " + entry.category + "\n  " + entry.description + " · " + new Date(entry.occurredAt).toLocaleDateString("en-US"),
    );
    const netLabel = result.net.startsWith("-") ? "زیان" : "سود";
    const netAmount = result.net.startsWith("-") ? result.net.slice(1) : result.net;
    await ctx.reply(
      "صورت‌حساب " + result.periodDays + " روز اخیر\nدرآمد: " + cash(result.income) + " Cash\nهزینه: " + cash(result.expenses) + " Cash\n" + netLabel + ": " + cash(netAmount) + " Cash\nمعوقات عملیاتی: " + cash(result.operatingArrears) + " Cash\n\nگردش‌های اخیر:\n" + (entries.join("\n\n") || "No finance entries"),
    );
  } catch (error) { await ctx.reply("Could not load financial statement: " + (error instanceof Error ? error.message : "unknown error")); }
});
bot.command("upgrade", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /upgrade in a private chat.");
  const facility = String(ctx.match ?? "").trim().toLowerCase();
  const value = ({ stadium: "STADIUM", training: "TRAINING_GROUND", academy: "ACADEMY" } as const)[facility as "stadium" | "training" | "academy"];
  if (!value) return ctx.reply("Usage: /upgrade stadium|training|academy");
  try {
    const result = await api<{ upgrade: { level?: number; cost?: string; replayed: boolean } }>(
      `/v1/club/facilities/${value}/upgrade`, ctx.from.id, "POST",
      { idempotencyKey: `tg-upgrade-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.upgrade.replayed ? "This upgrade request was already processed." : `${facility} upgraded to level ${result.upgrade.level}. Cost: ${cash(result.upgrade.cost ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Facility upgrade failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("ticket-price", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /ticket-price in a private chat.");
  const price = String(ctx.match ?? "").trim();
  if (!/^(?:[1-9][0-9]?|[1-4][0-9]{2}|500)$/.test(price) || Number(price) < 10) {
    return ctx.reply("Usage: /ticket-price 10-500");
  }
  try {
    const current = await api<{ club: { ticketPrice: string } }>("/v1/club/operations", ctx.from.id);
    const result = await api<{ ticketing: { ticketPrice: string } }>(
      "/v1/club/stadium/ticket-price", ctx.from.id, "PATCH",
      { ticketPrice: price, expectedTicketPrice: current.club.ticketPrice },
    );
    await ctx.reply(`Stadium ticket price set to ${cash(result.ticketing.ticketPrice)} Cash.`);
  } catch (error) { await ctx.reply(`Ticket price update failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("scout", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /scout in a private chat.");
  try {
    const result = await api<{ scouting: { prospects: Array<{ id: string; firstName: string; lastName: string; age: number; position: string; overall: number; potential: number; recruitmentCost: string }>; scoutingCost?: string; replayed: boolean } }>(
      "/v1/club/academy/scout", ctx.from.id, "POST",
      { idempotencyKey: `tg-scout-${ctx.from.id}-${ctx.update.update_id}` },
    );
    if (result.scouting.replayed) return ctx.reply("This scouting request was already processed.");
    const lines = result.scouting.prospects.map((p) => `• ${p.firstName} ${p.lastName} · ${p.age}y · ${p.position} · OVR ${p.overall}/POT ${p.potential}\n  Cost ${cash(p.recruitmentCost)} Cash · ID ${p.id}`);
    await ctx.reply(`Scouting complete. Cost: ${cash(result.scouting.scoutingCost ?? "0")} Cash\n\n${lines.join("\n\n")}\n\nRecruit with /recruit PROSPECT_ID`);
  } catch (error) { await ctx.reply(`Academy scouting failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("recruit", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /recruit in a private chat.");
  const prospectId = String(ctx.match ?? "").trim();
  if (!prospectId) return ctx.reply("Usage: /recruit PROSPECT_ID");
  try {
    const result = await api<{ recruitment: { player?: { firstName: string; lastName: string; overall: number; potential: number }; cost?: string; replayed: boolean } }>(
      `/v1/club/academy/${encodeURIComponent(prospectId)}/recruit`, ctx.from.id, "POST",
      { idempotencyKey: `tg-recruit-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.recruitment.replayed ? "This recruitment request was already processed." : `Signed ${result.recruitment.player?.firstName} ${result.recruitment.player?.lastName} · OVR ${result.recruitment.player?.overall}/POT ${result.recruitment.player?.potential}. Cost: ${cash(result.recruitment.cost ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Recruitment failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("sponsor", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /sponsor in a private chat.");
  const offerId = String(ctx.match ?? "").trim().toLowerCase();
  if (!["local-partner", "regional-brand", "national-network"].includes(offerId)) {
    try {
      const overview = await api<{ club: { sponsorOffers: Array<{ id: string; partnerName: string; tier: string; dailyIncome: string; signingBonus: string; durationDays: number }> } }>("/v1/club/operations", ctx.from.id);
      const offers = overview.club.sponsorOffers.map((offer) => "• " + offer.id + " · " + offer.partnerName + " (" + offer.tier + ") · " + cash(offer.dailyIncome) + " Cash/day · Bonus " + cash(offer.signingBonus) + " · " + offer.durationDays + " days");
      return ctx.reply("Available sponsor offers:\n" + (offers.join("\n") || "No offers unlocked") + "\n\n/sponsor OFFER_ID");
    } catch (error) { return ctx.reply("Could not load sponsor offers: " + (error instanceof Error ? error.message : "unknown error")); }
  }
  try {
    const result = await api<{ contract: { sponsor?: { partnerName: string; tier: string; dailyIncome: string }; replayed: boolean } }>(
      "/v1/club/sponsors/sign", ctx.from.id, "POST",
      { offerId, idempotencyKey: `tg-sponsor-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.contract.replayed ? "This sponsor contract was already signed." : `Signed ${result.contract.sponsor?.partnerName} (${result.contract.sponsor?.tier}). Daily income: ${cash(result.contract.sponsor?.dailyIncome ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Sponsor signing failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("coach-upgrade", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /coach-upgrade in a private chat.");
  try {
    const result = await api<{ upgrade: { coach?: { level: number; trainingSkill: number; recoverySkill: number; medicalSkill: number }; cost?: string; replayed: boolean } }>(
      "/v1/club/coach/upgrade", ctx.from.id, "POST",
      { idempotencyKey: `tg-coach-upgrade-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.upgrade.replayed ? "This coach upgrade was already processed." : `Coach upgraded to Lv.${result.upgrade.coach?.level}. Training ${result.upgrade.coach?.trainingSkill}, recovery ${result.upgrade.coach?.recoverySkill}, medical ${result.upgrade.coach?.medicalSkill}. Cost: ${cash(result.upgrade.cost ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Coach upgrade failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("hire-coach", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /hire-coach in a private chat.");
  const candidateId = String(ctx.match ?? "").trim().toLowerCase();
  if (!["balanced", "youth", "performance"].includes(candidateId)) {
    try {
      const overview = await api<{ club: { coachOffers: Array<{ id: string; name: string; signingFee: string; weeklySalary: string; trainingSkill: number; recoverySkill: number; medicalSkill: number }> } }>("/v1/club/operations", ctx.from.id);
      const offers = overview.club.coachOffers.map((candidate) => "• " + candidate.id + " · " + candidate.name + " · Fee " + cash(candidate.signingFee) + " · Salary " + cash(candidate.weeklySalary) + "/week · Skills " + candidate.trainingSkill + "/" + candidate.recoverySkill + "/" + candidate.medicalSkill);
      return ctx.reply("Available coaches:\n" + offers.join("\n") + "\n\n/hire-coach balanced|youth|performance");
    } catch (error) { return ctx.reply("Could not load coach candidates: " + (error instanceof Error ? error.message : "unknown error")); }
  }
  try {
    const result = await api<{ hiring: { coach?: { name: string; weeklySalary: string }; signingFee?: string; replayed: boolean } }>(
      "/v1/club/coach/hire", ctx.from.id, "POST",
      { candidateId, idempotencyKey: `tg-coach-hire-${ctx.from.id}-${ctx.update.update_id}` },
    );
    await ctx.reply(result.hiring.replayed ? "This coach hiring request was already processed." : `Hired ${result.hiring.coach?.name}. Signing fee: ${cash(result.hiring.signingFee ?? "0")} Cash · Weekly salary: ${cash(result.hiring.coach?.weeklySalary ?? "0")} Cash.`);
  } catch (error) { await ctx.reply(`Coach hiring failed: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("market", async (ctx) => {
  if (!ctx.from) return;
  try {
    const result = await api<{ listings: ApiListing[] }>("/v1/market/listings", ctx.from.id);
    if (!result.listings.length) return ctx.reply("There are no active transfer listings right now.");
    const lines = result.listings.map((item) =>
      `• ${playerName(item.player)} | ${item.player.position} | OVR ${item.player.overall}\n  ${cash(item.askingPrice)} Cash · ${item.sellerClub?.name ?? "Club"}\n  Listing ID: ${item.id}`,
    );
    await ctx.reply("Transfer market:\n\n" + lines.join("\n\n") + "\n\nBuy with /buy LISTING_ID");
  } catch (error) { await ctx.reply(`Could not load market: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("special", async (ctx) => {
  if (!ctx.from) return;
  try {
    const result = await api<{ players: Array<{ fullName: string; rarity: string; overall: number }>; packOffers: Array<{ method: string; rarity: string; priceGold: string }> }>("/v1/players/special", ctx.from.id);
    const offers = result.packOffers.map((offer) => `• ${offer.rarity}: ${offer.priceGold} Gold — /pack ${offer.method.replace("_pack", "")}`);
    const featured = result.players.slice(0, 10).map((player) => `• ${player.fullName} | ${player.rarity} | OVR ${player.overall}`);
    await ctx.reply("Special player packs:\n" + offers.join("\n") + "\n\nFeatured players:\n" + featured.join("\n"));
  } catch (error) { await ctx.reply(`Could not load special players: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("pack", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /pack in a private chat to acquire a special player.");
  const requested = String(ctx.match ?? "").trim().toLowerCase();
  const method = ({ epic: "epic_pack", legendary: "legendary_pack", icon: "icon_pack" } as const)[requested as "epic" | "legendary" | "icon"];
  if (!method) return ctx.reply("Usage: /pack epic|legendary|icon");
  try {
    const result = await api<{ acquisition: { specialPlayer: { fullName: string; rarity: string; overall: number }; goldBalance: string; replayed: boolean } }>("/v1/players/special/acquire", ctx.from.id, "POST", { method, idempotencyKey: `tg-${ctx.from.id}-${ctx.update.update_id}` });
    const item = result.acquisition.specialPlayer;
    await ctx.reply(`Acquired ${item.fullName} (${item.rarity}, OVR ${item.overall})!\nRemaining Gold: ${cash(result.acquisition.goldBalance)}${result.acquisition.replayed ? "\nThis was a repeated request." : ""}`);
  } catch (error) { await ctx.reply(`Could not acquire a player: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("sell", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /sell in a private chat to list a player.");
  const parts = String(ctx.match ?? "").trim().split(/\s+/);
  const [playerId, price] = parts;
  if (!playerId || !price || !/^[1-9][0-9]{0,14}$/.test(price)) {
    return ctx.reply("Usage: /sell PLAYER_ID PRICE\nUse /players to find your player IDs.");
  }
  try {
    const result = await api<{ listing: { id: string; askingPrice: string } }>("/v1/market/listings", ctx.from.id, "POST", {
      playerId, askingPrice: price, expiresInHours: 72,
    });
    await ctx.reply(`Listing created. Asking price: ${cash(result.listing.askingPrice)} Cash\nListing ID: ${result.listing.id}`);
  } catch (error) { await ctx.reply(`Could not create listing: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("buy", async (ctx) => {
  if (!ctx.from) return;
  if (ctx.chat.type !== "private") return ctx.reply("Use /buy in a private chat to buy a player.");
  const listingId = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!listingId) return ctx.reply("Usage: /buy LISTING_ID\nUse /market to see available listings.");
  try {
    const result = await api<{ purchase: { price: string; replayed: boolean } }>(
      `/v1/market/listings/${encodeURIComponent(listingId)}/buy`, ctx.from.id, "POST",
    );
    await ctx.reply(`Purchase completed. Paid ${cash(result.purchase.price)} Cash.${result.purchase.replayed ? " This was an already completed purchase." : ""}`);
  } catch (error) { await ctx.reply(`Could not complete purchase: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("opponents", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ opponents: Array<{ id: string; name: string; level: number; reputation: number }> }>("/v1/matches/opponents", ctx.from.id);
    const lines = result.opponents.map((club) => `• ${club.name} · Level ${club.level} · Rep ${club.reputation}\n  ID: ${club.id}`);
    await ctx.reply("Clubs ready for a friendly:\n" + (lines.join("\n\n") || "No eligible opponents yet.") + "\n\n/friendly CLUB_ID");
  } catch (error) { await ctx.reply(`Could not load opponents: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("friendly", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const opponentClubId = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!opponentClubId) return ctx.reply("Usage: /friendly CLUB_ID\nUse /opponents to find a club.");
  try {
    const result = await api<{ match: { id: string; scheduledAt: string }; replayed: boolean }>("/v1/matches/friendly", ctx.from.id, "POST", {
      opponentClubId, idempotencyKey: `bot-friendly-${ctx.from.id}-${ctx.update.update_id}`,
    });
    await ctx.reply(`Friendly scheduled. Match ID: ${result.match.id}\nKickoff: ${new Date(result.match.scheduledAt).toLocaleString("en-US")}\nUse /play ${result.match.id} when kickoff is due.`);
  } catch (error) { await ctx.reply(`Could not schedule friendly: ${error instanceof Error ? error.message : "unknown error"}`); }
});


bot.command("challenge", async (ctx) => {
  if (!ctx.from) return;
  try {
    const result = await api<{ challenge: { token: string; expiresAt: string }; asset: string; goldCost: string; shareUrl: string | null }>(
      "/v1/friendly-challenges", ctx.from.id, "POST", (ctx.chat.type === "group" || ctx.chat.type === "supergroup") ? { groupTelegramId: String(ctx.chat.id) } : {},
    );
    const invite = result.shareUrl ?? ("کد دعوت: " + result.challenge.token + "\nدستور پذیرش: /acceptchallenge " + result.challenge.token);
    const message = "چالش دوستانه ایجاد شد.\nهزینه: " + (result.asset === "FREE" ? "رایگان" : result.asset === "GOLD" ? result.goldCost + " گلد" : "اعتبار خریداری‌شده")
      + "\nاعتبار تا: " + new Date(result.challenge.expiresAt).toLocaleString("fa-IR") + "\n\n" + invite;
    const sent = await ctx.reply(message);
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") await scheduleGroupReplyDeletion(ctx.chat.id, sent.message_id);
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
    await ctx.reply("چالش پذیرفته شد. مسابقه " + result.match.id + " در " + new Date(result.match.scheduledAt).toLocaleString("fa-IR") + " برنامه‌ریزی شد.");
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
    await ctx.reply("هرم لیگ‌های سراسری · فصل " + result.season + "\n\n" + lines.join("\n\n")
      + "\n\n" + (history.length ? "آرشیو لیگ‌ها:\n" + history.join("\n\n") + "\n\n" : "")
      + (offers.length ? "پیشنهادهای صعود:\n" + offers.join("\n\n") + "\n\n" : "")
      + "برای ورود به لیگ پایه: /leagueapply");
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
    await ctx.reply(result.league.name + " · " + result.league.tierName + " · فصل " + result.league.season + "\n\nجدول:\n" + table.join("\n")
      + "\n\nگلزنان برتر:\n" + (scorers.join("\n") || "هنوز گلی ثبت نشده")
      + "\n\nپاسورهای برتر:\n" + (assists.join("\n") || "هنوز پاس گلی ثبت نشده")
      + (awards.length ? "\n\nجوایز:\n" + awards.join("\n") : ""));
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
        + " · " + new Date(match.scheduledAt).toLocaleString("fa-IR")
        + (open ? "\n  تصمیم تاکتیکی تا " + new Date(open.decisionDeadlineAt).toLocaleTimeString("fa-IR") + " · " + open.checkpointKey : "")
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
  const allowed:Record<string,string[]> = {
    formation:["4-3-3","4-4-2","3-5-2","4-2-3-1"],
    mentality:["DEFENSIVE","BALANCED","ATTACKING"],
    pressing:["LOW_BLOCK","MID_BLOCK","HIGH_PRESS"],
    tempo:["SLOW","NORMAL","FAST"],
    passingStyle:["SHORT","MIXED","DIRECT"],
  };
  const changes:Record<string,string>={};
  for(const part of String(ctx.match??"").trim().split(/\s+/).filter(Boolean)){
    const i=part.indexOf("=");
    if(i<1)return ctx.reply("هر تنظیم باید به شکل key=value باشد.");
    const key=part.slice(0,i),value=part.slice(i+1).toUpperCase();
    if(!allowed[key]?.includes(value))return ctx.reply("مقدار نامعتبر: "+part);
    changes[key]=value;
  }
  if(!Object.keys(changes).length)return ctx.reply("استفاده: /setfallback formation=4-4-2 mentality=DEFENSIVE pressing=LOW_BLOCK tempo=SLOW passingStyle=SHORT");
  try{
    const current=await api<{plan:Record<string,string>;version:number}>("/v1/matches/fallback-plan",ctx.from.id);
    const plan={...current.plan,...changes};
    const saved=await api<{version:number}>("/v1/matches/fallback-plan",ctx.from.id,"PUT",{expectedVersion:current.version,plan});
    await ctx.reply("برنامه جایگزین ذخیره شد. نسخه "+saved.version+"؛ از مسابقه بعدی که شروع شود اعمال خواهد شد.");
  }catch(error){await ctx.reply("ذخیره برنامه جایگزین ناموفق بود: "+(error instanceof Error?error.message:"unknown error"));}
});

bot.command("play", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const matchId = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!matchId) return ctx.reply("Usage: /play MATCH_ID");
  try {
    const result = await api<{ result: { replayed: boolean; homeClub?: string; awayClub?: string; homeScore: number | null; awayScore: number | null; homePenalties?: number | null; awayPenalties?: number | null; attendance?: number; ticketRevenue?: string; events?: Array<{ minute: number; type: string; detail: string; playerName?: string; relatedPlayerName?: string | null }> } }>(`/v1/matches/${encodeURIComponent(matchId)}/simulate`, ctx.from.id, "POST", {});
    const match = result.result;
    const eventLabels: Record<string, string> = {
      GOAL: "گل", YELLOW_CARD: "کارت زرد", RED_CARD: "کارت قرمز",
      INJURY: "مصدومیت", SUBSTITUTION: "تعویض",
    };
    const events = (match.events ?? []).slice(0, 24).map((event) => {
      const label = eventLabels[event.type] ?? event.type;
      const related = event.type === "SUBSTITUTION"
        ? (event.relatedPlayerName ? " · ورود: " + event.relatedPlayerName : "")
        : event.relatedPlayerName ? " · پاس گل: " + event.relatedPlayerName : "";
      return `${event.minute}' · ${label} · ${event.playerName ?? "بازیکن"}${related}`;
    });
    await ctx.reply(
      `${match.homeClub ?? "Home"} ${match.homeScore ?? 0} – ${match.awayScore ?? 0} ${match.awayClub ?? "Away"}${match.homePenalties !== null && match.homePenalties !== undefined ? " (pens " + match.homePenalties + "–" + match.awayPenalties + ")" : ""}\nAttendance: ${match.attendance ?? 0}\nGate revenue: ${cash(match.ticketRevenue ?? "0")} Cash\n${match.replayed ? "Already simulated; no rewards were repeated." : "Full-time."}\n\n${events.join("\n") || "No major events."}`,
    );
  } catch (error) { await ctx.reply(`Could not simulate match: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("league", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const parts = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const last = parts.at(-1);
  const maxTeams = last && /^\d+$/.test(last) ? Number(parts.pop()) : 8;
  const name = parts.join(" ");
  if (name.length < 3 || name.length > 40 || !Number.isInteger(maxTeams) || maxTeams < 4 || maxTeams > 10) {
    return ctx.reply("Usage: /league LEAGUE NAME [4-10]");
  }
  try {
    const result = await api<{ competition: { id: string; name: string; maxTeams: number }; replayed: boolean }>("/v1/competitions", ctx.from.id, "POST", {
      name, maxTeams, idempotencyKey: `bot-league-${ctx.from.id}-${ctx.update.update_id}`,
    });
    await ctx.reply(`League created: ${result.competition.name}\nID: ${result.competition.id}\nCapacity: ${result.competition.maxTeams} clubs\nInvite other managers with /leagues.`);
  } catch (error) { await ctx.reply(`Could not create league: ${error instanceof Error ? error.message : "unknown error"}`); }
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
    return ctx.reply("Usage: /cup CUP NAME [4|8] [legs=1|2]");
  }
  try {
    const result = await api<{ competition: { id: string; name: string; maxTeams: number; cupLegs:number }; replayed: boolean }>("/v1/competitions", ctx.from.id, "POST", {
      name, maxTeams, format: "CUP", cupLegs, idempotencyKey: "bot-cup-" + ctx.from.id + "-" + ctx.update.update_id,
    });
    await ctx.reply("Knockout cup created: " + result.competition.name + "\nID: " + result.competition.id
      + "\nBracket: " + result.competition.maxTeams + " clubs · "
      + (result.competition.cupLegs === 2 ? "two-legged ties" : "single-match ties")
      + ". Fill all places before starting.");
  } catch (error) { await ctx.reply("Could not create cup: " + (error instanceof Error ? error.message : "unknown error")); }
});
bot.command("competitionrules", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const parts = String(ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
  const competitionId = parts.shift();
  if (!competitionId) return ctx.reply("Usage: /competitionrules COMPETITION_ID subs=5 windows=3 injuries=on red=1 yellow=3 yellowban=1 penalties=on");
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
      } else return ctx.reply("Invalid rule: " + part);
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
    await ctx.reply("Could not update competition rules: " + (error instanceof Error ? error.message : "unknown error"));
  }
});

bot.command("leagues", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  try {
    const result = await api<{ competitions: Array<{ id: string; name: string; season: number; format: string; teams: number; maxTeams: number; joined: boolean; isCreator: boolean }> }>("/v1/competitions", ctx.from.id);
    const lines = result.competitions.map((item) =>
      `• ${item.name} · ${item.format === "CUP" ? "Knockout cup" : "League"} · ${item.teams}/${item.maxTeams} clubs · Season ${item.season}${item.joined ? " · joined" : ""}\n  ID: ${item.id}`,
    );
    await ctx.reply("Open competitions:\n" + (lines.join("\n\n") || "No open leagues.") + "\n\n/joinleague ID");
  } catch (error) { await ctx.reply(`Could not load leagues: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("joinleague", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("Usage: /joinleague COMPETITION_ID");
  try {
    const result = await api<{ joined: boolean; replayed: boolean; teams: number }>(`/v1/competitions/${encodeURIComponent(id)}/join`, ctx.from.id, "POST", {});
    await ctx.reply(`You are registered. Clubs in league: ${result.teams}.`);
  } catch (error) { await ctx.reply(`Could not join league: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("startleague", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("Usage: /startleague COMPETITION_ID");
  try {
    const result = await api<{ fixturesCreated: number; rounds: number; teams: number }>(`/v1/competitions/${encodeURIComponent(id)}/start`, ctx.from.id, "POST", {});
    await ctx.reply(`League started with ${result.teams} clubs. ${result.fixturesCreated} fixtures across ${result.rounds} rounds have been scheduled.`);
  } catch (error) { await ctx.reply(`Could not start league: ${error instanceof Error ? error.message : "unknown error"}`); }
});

bot.command("startcup", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("Usage: /startcup CUP_ID");
  try {
    const result = await api<{ fixturesCreated: number; rounds: number; teams: number; replayed?: boolean }>(`/v1/competitions/${encodeURIComponent(id)}/start`, ctx.from.id, "POST", {});
    await ctx.reply("Cup started with " + result.teams + " clubs. " + result.fixturesCreated + " first-round fixtures; " + result.rounds + " knockout rounds.");
  } catch (error) { await ctx.reply("Could not start cup: " + (error instanceof Error ? error.message : "unknown error")); }
});
bot.command("table", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  const id = String(ctx.match ?? "").trim().split(/\s+/)[0];
  if (!id) return ctx.reply("Usage: /table COMPETITION_ID");
  try {
    const result = await api<{ competition: { name: string; status: string; format: string }; standings: Array<{ position: number; clubName: string; played: number; won: number; drawn: number; lost: number; goalDifference: number; points: number }>; matches: Array<{ round: number | null; homeClub: { name: string }; awayClub: { name: string }; homeScore: number | null; awayScore: number | null; homePenalties: number | null; awayPenalties: number | null }> }>(`/v1/competitions/${encodeURIComponent(id)}`, ctx.from.id);
    const rows = result.competition.format === "CUP"
      ? result.matches.map((match) => "Round " + match.round + ": " + match.homeClub.name + " " + (match.homeScore ?? "–") + "–" + (match.awayScore ?? "–") + " " + match.awayClub.name + (match.homePenalties !== null ? " (pens " + match.homePenalties + "–" + match.awayPenalties + ")" : ""))
      : result.standings.map((row) => row.position + ". " + row.clubName + " · Pts " + row.points + " · P " + row.played + " · W " + row.won + " D " + row.drawn + " L " + row.lost + " · GD " + row.goalDifference);
    await ctx.reply(result.competition.name + " · " + result.competition.status + "\n\n" + rows.join("\n"));
  } catch (error) { await ctx.reply("Could not load standings: " + (error instanceof Error ? error.message : "unknown error")); }
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
  const amount=String(ctx.match??"").trim(); if(!/^\\d{1,12}$/.test(amount)||BigInt(amount)<=BigInt(0))return ctx.reply("استفاده: /alliance-contribute AMOUNT");
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
    const result = await publicApi<{ season:number; matches:number; awards:{topScorer:{playerName:string;clubName:string;goals:number}|null;topAssists:{playerName:string;clubName:string;assists:number}|null;playerOfSeason:{playerName:string;clubName:string;averageRating:number}|null;teamOfSeason:Array<{playerName:string;clubName:string;position:string;averageRating:number}>};leaders:{scorers:Array<{playerName:string;clubName:string;goals:number}>;assists:Array<{playerName:string;clubName:string;assists:number}>} }>(
      "/v1/seasons/" + season + "/awards",
    );
    const line = (label:string, row:{playerName:string;clubName:string}|null, stat:string) => label + ": " + (row ? row.playerName + " · " + row.clubName + " · " + stat : "ثبت نشده");
    const team = result.awards.teamOfSeason.map((p,i)=>(i+1)+". "+p.playerName+" · "+p.position+" · "+p.clubName+" · "+p.averageRating.toFixed(2));
    await ctx.reply("آرشیو فصل "+result.season+" · "+result.matches+" مسابقه\n\n"+
      line("بهترین گلزن",result.awards.topScorer,result.awards.topScorer?.goals+" گل")+"\n"+
      line("بهترین پاسور",result.awards.topAssists,result.awards.topAssists?.assists+" پاس گل")+"\n"+
      line("بازیکن فصل",result.awards.playerOfSeason,result.awards.playerOfSeason?.averageRating.toFixed(2)+" امتیاز")+
      "\n\nتیم منتخب فصل ۴-۳-۳:\n"+(team.join("\n")||"اطلاعات کافی نیست"));
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

bot.on(["chat_member","my_chat_member"],async ctx=>{
 if(ctx.chat.type!=="group"&&ctx.chat.type!=="supergroup")return;
 try{const memberCount=await ctx.api.getChatMemberCount(ctx.chat.id);await apiSystem("/v1/groups/system/member-count",{telegramGroupId:String(ctx.chat.id),memberCount});}
 catch(error){console.warn("Could not refresh Telegram group membership:",error instanceof Error?error.message:error);}
});
bot.catch((error) => console.error("Telegram bot error:", error));
if (apiUrl && botApiSecret) {
  const deletionQueueTimer = setInterval(() => { void pollGroupMessageDeletionQueue(); }, 5_000);
  const matchNotificationTimer = setInterval(() => { void pollMatchCheckpointNotifications(); }, 5_000);
  const leagueNoticeTimer = setInterval(() => { void pollLeagueNoticeQueue(); }, 10_000);
  matchNotificationTimer.unref();
  leagueNoticeTimer.unref();
  void pollLeagueNoticeQueue();
  void pollMatchCheckpointNotifications();
  deletionQueueTimer.unref();
  void pollGroupMessageDeletionQueue();
} else {
  console.warn("Durable group message deletion worker is disabled: configure FOOTBALL_API_URL and BOT_API_SECRET.");
}

await bot.start();
