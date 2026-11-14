import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required to start the bot.");
const webAppUrl = process.env.TELEGRAM_WEB_APP_URL;
const apiUrl = process.env.FOOTBALL_API_URL;
const botApiSecret = process.env.BOT_API_SECRET;
const bot = new Bot(token);

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

    const cashBalance = account.wallets.find((wallet) => wallet.asset === "CASH")?.balance ?? "0";
    const goldBalance = account.wallets.find((wallet) => wallet.asset === "GOLD")?.balance ?? "0";
    const keyboard = new InlineKeyboard();
    if (webAppUrl) keyboard.webApp("Open Football Empire", webAppUrl);

    await ctx.reply(
      `Welcome, ${account.user.displayName}! Your club is ready.\n\n` +
      `Club: ${account.club?.name ?? "Not created"} (Level ${account.club?.level ?? 1})\n` +
      `Starter balance: ${cash(cashBalance)} Cash · ${cash(goldBalance)} Gold\n\n` +
      `You can manage your club directly here or continue in the Mini App.\n\n` +
      `Commands: /club /wallet /rename /players /lineup /development /train /renew /market /special /pack /sell /buy`,
      { reply_markup: keyboard },
    );
  } catch (error) {
    await ctx.reply(`Could not create or load your club: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

bot.command("help", async (ctx) => ctx.reply(
  "Football Empire commands:\n/club — club profile\n/wallet — Cash and Gold balances\n/rename NEW NAME — rename your club\n/players — your active squad\n/lineup — view starting XI and tactics\n/setlineup FORMATION ID1 ... ID11 — set your XI\n/development — player development overview\n/train PLAYER_ID FOCUS INTENSITY — train a player\n/renew PLAYER_ID DAYS WEEKLY_WAGE — renew a contract\n/operations — facilities, academy, sponsors and finance\n/finance [DAYS] — income and expense statement\n/upgrade stadium|training|academy — upgrade a facility\n/ticket-price PRICE — set stadium ticket price\n/scout — find academy prospects\n/recruit PROSPECT_ID — sign an academy prospect\n/sponsor OFFER_ID — sign a sponsor\n/coach-upgrade — develop your coach\n/hire-coach balanced|youth|performance — hire a coach\n/market — open transfer listings\n/sell PLAYER_ID PRICE — list a generated player\n/buy LISTING_ID — buy a listed player\n/special — view special players and pack prices\n/pack epic|legendary|icon — acquire a special player\n\nSpecial players are not tradeable in the regular market.",
));

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
  if (!["local-partner", "regional-brand", "national-network"].includes(offerId)) return ctx.reply("Usage: /sponsor local-partner|regional-brand|national-network");
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
  if (!["balanced", "youth", "performance"].includes(candidateId)) return ctx.reply("Usage: /hire-coach balanced|youth|performance");
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

bot.catch((error) => console.error("Telegram bot error:", error));
await bot.start();
