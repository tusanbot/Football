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
  "Football Empire commands:\n/club — club profile\n/wallet — Cash and Gold balances\n/rename NEW NAME — rename your club\n/players — your active squad\n/lineup — view starting XI and tactics\n/setlineup FORMATION ID1 ... ID11 — set your XI\n/development — player development overview\n/train PLAYER_ID FOCUS INTENSITY — train a player\n/renew PLAYER_ID DAYS WEEKLY_WAGE — renew a contract\n/market — open transfer listings\n/sell PLAYER_ID PRICE — list a generated player\n/buy LISTING_ID — buy a listed player\n/special — view special players and pack prices\n/pack epic|legendary|icon — acquire a special player\n\nSpecial players are not tradeable in the regular market.",
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
      coach: { name: string; level: number; trainingSkill: number; recoverySkill: number; medicalSkill: number };
      players: Array<{ id: string; firstName: string; lastName: string; overall: number; potential: number; age: number; fitness: number; morale: number; contractDays: number; status: string; minimumWeeklyWage: string; maximumWeeklyWage: string }>;
    } }>("/v1/club/development", ctx.from.id);
    const lines = result.club.players.slice(0, 15).map((p) =>
      `• ${p.firstName} ${p.lastName} · OVR ${p.overall}/${p.potential} · Age ${p.age}\n  Fitness ${p.fitness} · Morale ${p.morale} · Contract ${p.contractDays}d · ${p.status}\n  Renew ${cash(p.minimumWeeklyWage)}–${cash(p.maximumWeeklyWage)} Cash/week\n  ID: ${p.id}`,
    );
    await ctx.reply(
      `Player development · Training ground Lv.${result.club.trainingGroundLevel}\nWeekly wage bill: ${cash(result.club.weeklyWageBill)} Cash · Arrears: ${cash(result.club.wageArrears)} Cash\nCoach: ${result.club.coach.name} (Lv.${result.club.coach.level})\nTraining ${result.club.coach.trainingSkill} · Recovery ${result.club.coach.recoverySkill} · Medical ${result.club.coach.medicalSkill}\n\n` +
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
