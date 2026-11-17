import { createBotApp } from "./bot-app.js";

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  FOOTBALL_API_URL: string;
  BOT_API_SECRET: string;
  TELEGRAM_WEB_APP_URL?: string;
  ENVIRONMENT?: string;
  ANALYTICS_HASH_SECRET?: string;
  PILOT_ANALYTICS?: { writeDataPoint(data: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void };
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

let cachedBotId: number | undefined;
let apiReadyUntil = 0;

async function ensureApiReady(env: Env) {
  if (Date.now() < apiReadyUntil) return;
  const response = await fetch(new URL("/ready", env.FOOTBALL_API_URL), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Game API is not ready (HTTP " + response.status + ").");
  apiReadyUntil = Date.now() + 10_000;
}

async function analyticsUserKey(telegramUserId: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(telegramUserId)));
  return Array.from(new Uint8Array(signature).slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function recordPilotEvent(update: unknown, env: Env) {
  if (!env.PILOT_ANALYTICS || !env.ANALYTICS_HASH_SECRET) return;
  const data = update as Record<string, any>;
  const message = data.message ?? data.edited_message;
  const callback = data.callback_query;
  const text = typeof message?.text === "string" ? message.text : "";
  const command = text.match(/^\\/([a-z0-9_]+)/i)?.[1]?.toLowerCase() ?? "";
  const eventName = command === "start" ? "bot_start" : command ? "bot_command" : callback ? "bot_callback" : "bot_update";
  const userId = message?.from?.id ?? callback?.from?.id;
  if (!Number.isSafeInteger(userId)) return;
  const userKey = await analyticsUserKey(userId, env.ANALYTICS_HASH_SECRET);
  const callbackPrefix = typeof callback?.data === "string" ? callback.data.split(":", 1)[0] : "";
  env.PILOT_ANALYTICS.writeDataPoint({
    blobs: [eventName, command || callbackPrefix, message?.chat?.type ?? callback?.message?.chat?.type ?? "unknown", callback ? "callback_query" : message?.text ? "text_message" : "message"],
    doubles: [1],
    indexes: [userKey],
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i]! ^ b[i]!;
  return mismatch === 0;
}

async function prepareBot(env: Env) {
  const instance = createBotApp({
    token: env.TELEGRAM_BOT_TOKEN,
    apiUrl: env.FOOTBALL_API_URL,
    botApiSecret: env.BOT_API_SECRET,
    ...(env.TELEGRAM_WEB_APP_URL ? { webAppUrl: env.TELEGRAM_WEB_APP_URL } : {}),
    environment: env.ENVIRONMENT ?? "staging",
  });
  if (cachedBotId === undefined) cachedBotId = (await instance.bot.api.getMe()).id;
  instance.setBotTelegramId(cachedBotId);
  return instance;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok", { status: 200 });
    if (url.pathname !== "/telegram/webhook") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
    const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!env.TELEGRAM_WEBHOOK_SECRET || !constantTimeEqual(suppliedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 1_048_576) return new Response("Payload too large", { status: 413 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1_048_576) return new Response("Payload too large", { status: 413 });
    let update: unknown;
    try { update = JSON.parse(raw) as unknown; } catch { return new Response("Invalid JSON", { status: 400 }); }
    if (!update || typeof update !== "object" || !Number.isSafeInteger((update as { update_id?: unknown }).update_id)) {
      return new Response("Invalid Telegram update", { status: 400 });
    }
    try {
      await ensureApiReady(env);
      await recordPilotEvent(update, env).catch(() => undefined);
      const { bot } = await prepareBot(env);
      await bot.handleUpdate(update as never);
      return new Response("ok", { status: 200 });
    } catch (error) {
      console.error("Telegram webhook processing failed", error instanceof Error ? error.message : "unknown error");
      return new Response("Temporary processing failure", { status: 500 });
    }
  },

  async scheduled(_controller: { scheduledTime: number; cron: string }, env: Env, ctx: ExecutionContextLike): Promise<void> {
    ctx.waitUntil((async () => {
      await ensureApiReady(env);
      const { runBackgroundJobs } = await prepareBot(env);
      await runBackgroundJobs();
    })());
  },
};
