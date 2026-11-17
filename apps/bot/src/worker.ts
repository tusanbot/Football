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
  BOT_UPDATE_GUARD: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
}

interface GuardRecord { state: "processing" | "complete"; updatedAt: number; }
interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  setAlarm(time: number): Promise<void>;
  transaction<T>(callback: (transaction: StorageLike) => Promise<T>): Promise<T>;
}
interface DurableObjectStateLike { storage: StorageLike; }

export class BotUpdateGuard {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const action = new URL(request.url).pathname;
    let payload: { updateId?: unknown };
    try { payload = await request.json() as { updateId?: unknown }; } catch { return new Response("Invalid JSON", { status: 400 }); }
    if (!Number.isSafeInteger(payload.updateId) || (payload.updateId as number) < 0) return new Response("Invalid update id", { status: 400 });
    const key = "update:" + String(payload.updateId);
    const now = Date.now();
    if (action === "/claim") {
      const result = await this.state.storage.transaction(async transaction => {
        const current = await transaction.get<GuardRecord>(key);
        if (current?.state === "complete" && now - current.updatedAt < 7 * 24 * 60 * 60 * 1000) return "duplicate";
        if (current?.state === "processing" && now - current.updatedAt < 60_000) return "busy";
        await transaction.put(key, { state: "processing", updatedAt: now } satisfies GuardRecord);
        return "claimed";
      });
      await this.state.storage.setAlarm(now + 24 * 60 * 60 * 1000);
      return Response.json({ result }, { status: result === "busy" ? 409 : 200 });
    }
    if (action === "/complete") {
      await this.state.storage.transaction(async transaction => {
        const current = await transaction.get<GuardRecord>(key);
        if (current?.state === "processing") await transaction.put(key, { state: "complete", updatedAt: now } satisfies GuardRecord);
      });
      return new Response("ok");
    }
    if (action === "/release") {
      await this.state.storage.transaction(async transaction => {
        const current = await transaction.get<GuardRecord>(key);
        if (current?.state === "processing") await transaction.delete(key);
      });
      return new Response("ok");
    }
    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const entries = await this.state.storage.list<GuardRecord>({ prefix: "update:" });
    const now = Date.now();
    for (const [key, record] of entries) {
      if (now - record.updatedAt > 7 * 24 * 60 * 60 * 1000) await this.state.storage.delete(key);
    }
    if ((await this.state.storage.list({ prefix: "update:" })).size > 0) await this.state.storage.setAlarm(now + 24 * 60 * 60 * 1000);
  }
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
  type MessageLike = { text?: unknown; chat?: { type?: string }; from?: { id?: number } };
  type CallbackLike = { data?: unknown; from?: { id?: number }; message?: { chat?: { type?: string } } };
  const data = update as { message?: MessageLike; edited_message?: MessageLike; callback_query?: CallbackLike };
  const message = data.message ?? data.edited_message;
  const callback = data.callback_query;
  const text = typeof message?.text === "string" ? message.text : "";
  const command = text.match(/^\\/([a-z0-9_]+)/i)?.[1]?.toLowerCase() ?? "";
  const eventName = command === "start" ? "bot_start" : command ? "bot_command" : callback ? "bot_callback" : "bot_update";
  const userId = message?.from?.id ?? callback?.from?.id;
  if (typeof userId !== "number" || !Number.isSafeInteger(userId)) return;
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
    const guard = env.BOT_UPDATE_GUARD.get(env.BOT_UPDATE_GUARD.idFromName("telegram-primary"));
    const updateId = (update as { update_id: number }).update_id;
    const claim = await guard.fetch(new Request("https://bot-update-guard/claim", { method: "POST", body: JSON.stringify({ updateId }) }));
    if (claim.status === 409) return new Response("Update is already being processed; retry later", { status: 503 });
    if (!claim.ok) return new Response("Could not claim update", { status: 503 });
    const claimResult = await claim.json() as { result: string };
    if (claimResult.result === "duplicate") return new Response("ok", { status: 200 });
    try {
      await ensureApiReady(env);
      await recordPilotEvent(update, env).catch(() => undefined);
      const { bot } = await prepareBot(env);
      await bot.handleUpdate(update as never);
      await guard.fetch(new Request("https://bot-update-guard/complete", { method: "POST", body: JSON.stringify({ updateId }) }));
      return new Response("ok", { status: 200 });
    } catch (error) {
      await guard.fetch(new Request("https://bot-update-guard/release", { method: "POST", body: JSON.stringify({ updateId }) })).catch(() => undefined);
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
