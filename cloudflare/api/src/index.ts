import { Buffer } from "node:buffer";
import { buildApp } from "../../../apps/api/src/app.js";
import { createPrismaClient, withPrismaClient } from "../../../apps/api/src/db.js";
import { processDueMatchRuntimes } from "../../../apps/api/src/game/match-service.js";
import { processDuePromotionOffers } from "../../../apps/api/src/game/league-pyramid-service.js";

interface Env {
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  TELEGRAM_BOT_TOKEN?: string;
  BOT_API_SECRET?: string;
  CORS_ORIGIN?: string;
  GAME_ADMIN_TELEGRAM_IDS?: string;
  ENVIRONMENT?: string;
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
const MAX_BODY_BYTES = 1_048_576;
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
class PayloadTooLargeError extends Error {}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
function dbUrl(env: Env): string | null { return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? null; }
function missingConfig(env: Env): string[] {
  const missing: string[] = [];
  if (!dbUrl(env)) missing.push("HYPERDRIVE or DATABASE_URL");
  if (!env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!env.BOT_API_SECRET || env.BOT_API_SECRET.length < 32 || /^(replace-with|change-me|your-)/i.test(env.BOT_API_SECRET)) missing.push("BOT_API_SECRET");
  if (!env.CORS_ORIGIN) missing.push("CORS_ORIGIN");
  if (!env.GAME_ADMIN_TELEGRAM_IDS) missing.push("GAME_ADMIN_TELEGRAM_IDS");
  return missing;
}
function configureEnv(env: Env): void {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = dbUrl(env) ?? "";
  process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN ?? "";
  process.env.BOT_API_SECRET = env.BOT_API_SECRET ?? "";
  process.env.CORS_ORIGIN = env.CORS_ORIGIN ?? "";
  process.env.GAME_ADMIN_TELEGRAM_IDS = env.GAME_ADMIN_TELEGRAM_IDS ?? "";
}
let appInstance: ReturnType<typeof buildApp> | undefined;
async function getApp(env: Env) {
  configureEnv(env);
  appInstance ??= buildApp();
  await appInstance.ready();
  return appInstance;
}
async function boundedPayload(request: Request): Promise<Buffer | undefined> {
  if (["GET", "HEAD"].includes(request.method.toUpperCase()) || !request.body) return undefined;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new PayloadTooLargeError();
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return total ? Buffer.concat(chunks, total) : undefined;
}
function fetchResponse(result: { statusCode: number; headers: Record<string, string | number | string[] | undefined>; payload: string }): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(result.headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, String(value));
  }
  return new Response(result.statusCode === 204 || result.statusCode === 304 ? null : result.payload, { status: result.statusCode, headers });
}
async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const missing = missingConfig(env);
  if (missing.length) return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing }, 503);
  let payload: Buffer | undefined;
  try { payload = await boundedPayload(request); }
  catch (error) {
    return error instanceof PayloadTooLargeError ? json({ error: "PAYLOAD_TOO_LARGE" }, 413) : json({ error: "INVALID_REQUEST_BODY" }, 400);
  }
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers.entries());
  delete headers.connection;
  delete headers["content-length"];
  delete headers["transfer-encoding"];
  const client = createPrismaClient(dbUrl(env) ?? undefined, 1);
  let cleanupScheduled = false;
  try {
    const app = await getApp(env);
    const result = await withPrismaClient(client, () => app.inject({
      method: request.method as never,
      url: url.pathname + url.search,
      headers,
      ...(payload ? { payload } : {}),
    }));
    const response = fetchResponse(result);
    cleanupScheduled = true;
    ctx.waitUntil(client.$disconnect().catch((error: unknown) => console.error("Prisma request client cleanup failed", error)));
    return response;
  } catch (error) {
    console.error("Cloudflare API request failed", error);
    return json({ error: "INTERNAL_SERVER_ERROR" }, 500);
  } finally {
    if (!cleanupScheduled) await client.$disconnect().catch(() => undefined);
  }
}
async function scheduledJobs(env: Env): Promise<void> {
  const missing = missingConfig(env);
  if (missing.length) { console.error("Scheduled game jobs skipped; missing configuration:", missing); return; }
  configureEnv(env);
  const client = createPrismaClient(dbUrl(env) ?? undefined, 1);
  try {
    await withPrismaClient(client, async () => {
      const now = new Date();
      const matches = await processDueMatchRuntimes("cloudflare-api-scheduled", now, 10);
      const promotions = await processDuePromotionOffers(now, 50);
      if (matches.advanced || matches.settled || matches.failed || promotions.accepted || promotions.completedLeagues) {
        console.info("Cloudflare scheduled game tick", { ...matches, promotions });
      }
    });
  } finally { await client.$disconnect(); }
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "football-empire-cloudflare-api", mode: "fastify-prisma-runtime" });
    }
    if (request.method === "GET" && url.pathname === "/ready" && missingConfig(env).length) {
      return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing: missingConfig(env) }, 503);
    }
    return handleApi(request, env, ctx);
  },
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledJobs(env).catch((error: unknown) => console.error("Cloudflare scheduled game jobs failed", error)));
  },
};
