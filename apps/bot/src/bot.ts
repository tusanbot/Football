import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createBotApp } from "./bot-app.js";
import { assertLongPollingWebhookClear } from "./telegram-ux.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiUrl = process.env.FOOTBALL_API_URL;
const botApiSecret = process.env.BOT_API_SECRET;
const webAppUrl = process.env.TELEGRAM_WEB_APP_URL;
if (!token || !apiUrl || !botApiSecret) throw new Error("TELEGRAM_BOT_TOKEN, FOOTBALL_API_URL, and BOT_API_SECRET are required.");
const apiSecret = botApiSecret;

const { bot, runBackgroundJobs, setBotTelegramId } = createBotApp({
  token, apiUrl, botApiSecret: apiSecret, ...(webAppUrl ? { webAppUrl } : {}), environment: process.env.NODE_ENV ?? "development",
});
const apiReadiness = await fetch(new URL("/ready", apiUrl), { signal: AbortSignal.timeout(15_000) });
if (!apiReadiness.ok) throw new Error("Football Empire API is not ready (HTTP " + apiReadiness.status + ").");
bot.catch((error) => console.error("Telegram bot error:", error));
const identity = await bot.api.getMe();
setBotTelegramId(identity.id);
const identityCheck = await fetch(new URL("/v1/bot/verify-identity", apiUrl), {
  method: "POST",
  headers: { "content-type": "application/json", "x-football-bot-secret": apiSecret },
  body: JSON.stringify({ telegramBotId: identity.id }),
  signal: AbortSignal.timeout(15_000),
});
if (!identityCheck.ok) throw new Error("The API and Bot Telegram tokens do not identify the same Bot (HTTP " + identityCheck.status + ").");
assertLongPollingWebhookClear((await bot.api.getWebhookInfo()).url);

const instanceId = randomUUID();
async function lease(action: "acquire" | "heartbeat" | "release") {
  const response = await fetch(new URL("/v1/bot/runtime/lease", apiUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-football-bot-secret": botApiSecret },
    body: JSON.stringify({ instanceId, action }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Bot runtime lease request failed: HTTP " + response.status);
  return await response.json() as { acquired?: boolean };
}
if (!(await lease("acquire")).acquired) throw new Error("Another Football Empire Bot process already owns the Telegram polling lease.");

const timers = [
  setInterval(() => { void runBackgroundJobs(); }, 5_000),
  setInterval(() => { void lease("heartbeat").then(result => {
    if (!result.acquired) throw new Error("Bot polling lease was lost.");
  }).catch(error => { console.error(error); process.exitCode = 1; void stop(); }); }, 15_000),
];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearInterval(timer);
  bot.stop();
  await lease("release").catch(error => console.error("Could not release Bot runtime lease:", error));
}
process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });
void runBackgroundJobs();
console.info("Football Empire Bot started in long-polling mode.");
await bot.start({ allowed_updates: ["message", "edited_message", "callback_query", "chat_member", "my_chat_member"] });
