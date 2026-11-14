import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required to start the bot.");
const webAppUrl = process.env.TELEGRAM_WEB_APP_URL;
const apiUrl = process.env.FOOTBALL_API_URL;
const botApiSecret = process.env.BOT_API_SECRET;
const bot = new Bot(token);

type ApiPlayer = { id: string; firstName: string; lastName: string; position: string; overall: number; potential: number; status?: string };
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
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `API request failed (${response.status})`);
  return data;
}

function cash(value: string) { return Number(value).toLocaleString("en-US"); }
function playerName(player: ApiPlayer) { return `${player.firstName} ${player.lastName}`; }

bot.command("start", async (ctx) => {
  const keyboard = new InlineKeyboard();
  if (webAppUrl) keyboard.webApp("Open Football Empire", webAppUrl);
  await ctx.reply("Welcome to Football Empire! Manage your club and use the same transfer market from this bot or the Mini App.\n\nCommands: /players /market /sell /buy", { reply_markup: keyboard });
});

bot.command("help", async (ctx) => ctx.reply(
  "Football Empire commands:\n/players — your active squad\n/market — open transfer listings\n/sell PLAYER_ID PRICE — list a generated player\n/buy LISTING_ID — buy a listed player\n\nSpecial players are not tradeable in the regular market.",
));

bot.command("players", async (ctx) => {
  if (!ctx.from) return;
  try {
    const result = await api<{ players: ApiPlayer[] }>("/v1/club/players", ctx.from.id);
    if (!result.players.length) return ctx.reply("Your squad is empty. Open the Mini App to complete club setup.");
    const lines = result.players.map((p) => `• ${playerName(p)} | ${p.position} | OVR ${p.overall} | POT ${p.potential}\n  ID: ${p.id}`);
    await ctx.reply("Your active squad:\n\n" + lines.join("\n"));
  } catch (error) { await ctx.reply(`Could not load squad: ${error instanceof Error ? error.message : "unknown error"}`); }
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

bot.command("sell", async (ctx) => {
  if (!ctx.from) return;
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
