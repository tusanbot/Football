import { createBotApp } from "./bot-app.js";

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  FOOTBALL_API_URL: string;
  BOT_API_SECRET: string;
  TELEGRAM_WEB_APP_URL?: string;
  ENVIRONMENT?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

let cachedBotId: number | undefined;

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
      const { runBackgroundJobs } = await prepareBot(env);
      await runBackgroundJobs();
    })());
  },
};
