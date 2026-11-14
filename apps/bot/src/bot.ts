import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required to start the bot.");
const webAppUrl = process.env.TELEGRAM_WEB_APP_URL;
const bot = new Bot(token);
bot.command("start", async (ctx) => {
  const keyboard = new InlineKeyboard();
  if (webAppUrl) keyboard.webApp("Open Football Empire", webAppUrl);
  await ctx.reply("Welcome to Football Empire! Your club, players, economy and competitions will be shared across the bot and Mini App.", { reply_markup: keyboard });
});
bot.command("help", async (ctx) => ctx.reply("Use /start to open Football Empire. Game commands will call the shared game API."));
bot.catch((error) => console.error("Telegram bot error:", error));
await bot.start();
