import { Buffer } from "node:buffer";
import { buildApp } from "../../../apps/api/src/app.js";
import {
  createPrismaClient,
  enterWorkerPrismaRequest,
  prisma,
  registerWorkerPrismaRequest,
  releaseWorkerPrismaRequest,
  requireRequestScopedPrisma,
  withPrismaClient,
} from "../../../apps/api/src/db.js";
import { processDueMatchRuntimes } from "../../../apps/api/src/game/match-service.js";
import { processDuePromotionOffers } from "../../../apps/api/src/game/league-pyramid-service.js";
import { isValidTelegramBotToken, parseAdminTelegramIds, parseCorsOrigins } from "../../../apps/api/src/runtime-config.js";

interface MatchCoordinatorNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}
interface MatchCoordinatorState {
  storage: {
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
}
interface Env {
  MATCH_COORDINATOR?: MatchCoordinatorNamespace;
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  TELEGRAM_BOT_TOKEN?: string;
  BOT_API_SECRET?: string;
  CORS_ORIGIN?: string;
  GAME_ADMIN_TELEGRAM_IDS?: string;
  ENVIRONMENT?: string;
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
requireRequestScopedPrisma();

const MAX_BODY_BYTES = 1_048_576;
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
class PayloadTooLargeError extends Error {}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
function dbUrl(env: Env): string | null { return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? null; }
function missingConfig(env: Env): string[] {
  const missing: string[] = [];
  const database = dbUrl(env);
  if (!database) missing.push("HYPERDRIVE or DATABASE_URL");
  else if (!/^postgres(?:ql)?:\/\//i.test(database)) missing.push("DATABASE_URL_INVALID");
  if (!isValidTelegramBotToken(env.TELEGRAM_BOT_TOKEN ?? "")) missing.push("TELEGRAM_BOT_TOKEN");
  if (!env.BOT_API_SECRET || env.BOT_API_SECRET.length < 32 || /^(replace-with|change-me|your-)/i.test(env.BOT_API_SECRET)) missing.push("BOT_API_SECRET");
  if (!parseAdminTelegramIds(env.GAME_ADMIN_TELEGRAM_IDS).length) missing.push("GAME_ADMIN_TELEGRAM_IDS");
  try {
    const production = env.ENVIRONMENT !== "development";
    const origins = parseCorsOrigins(env.CORS_ORIGIN, production);
    if (!origins.length) missing.push("CORS_ORIGIN");
    if (!production && origins.some((origin) => {
      const parsed = new URL(origin);
      return parsed.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    })) missing.push("CORS_ORIGIN_INVALID");
  } catch {
    missing.push("CORS_ORIGIN_INVALID");
  }
  return missing;
}
function configureEnv(env: Env): void {
   process.env.DATABASE_URL = dbUrl(env) ?? "";
  process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN ?? "";
  process.env.BOT_API_SECRET = env.BOT_API_SECRET ?? "";
  process.env.CORS_ORIGIN = env.CORS_ORIGIN ?? "";
  process.env.GAME_ADMIN_TELEGRAM_IDS = env.GAME_ADMIN_TELEGRAM_IDS ?? "";
}
// Construct and compile Fastify during Worker startup. Its router uses
// new Function while compiling routes, which requires allow_eval_during_startup.
const appInstance: ReturnType<typeof buildApp> = buildApp({ logger: false });
appInstance.addHook("onRequest", (request, _reply, done) => {
  const rawContextId = request.headers["x-football-prisma-context"];
  const contextId = Array.isArray(rawContextId) ? rawContextId[0] : rawContextId;
  if (typeof contextId !== "string" || !enterWorkerPrismaRequest(contextId)) {
    done(new Error("PRISMA_REQUEST_CONTEXT_MISSING"));
    return;
  }
  done();
});
await appInstance.ready();

async function getApp(env: Env) {
  // Runtime bindings are copied into process.env per request after startup.
  configureEnv(env);
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
  const requestContextId = registerWorkerPrismaRequest(client);
  let cleanupScheduled = false;
  try {
    const app = await getApp(env);
    headers["x-football-prisma-context"] = requestContextId;
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
    releaseWorkerPrismaRequest(requestContextId);
    if (!cleanupScheduled) await client.$disconnect().catch(() => undefined);
  }
}
export class MatchCoordinator {
  constructor(private readonly state: MatchCoordinatorState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/ensure") return json({ error: "NOT_FOUND" }, 404);
    await this.state.storage.setAlarm(Date.now() + 1_000);
    return json({ scheduled: true });
  }

  async alarm(): Promise<void> {
    const missing = missingConfig(this.env);
    if (missing.length) {
      console.error("Match coordinator paused; missing configuration:", missing);
      await this.state.storage.deleteAlarm();
      return;
    }

    const client = createPrismaClient(dbUrl(this.env) ?? undefined, 1);
    let nextAlarm: number | null = null;
    try {
      await withPrismaClient(client, async () => {
        const now = new Date();
        await processDueMatchRuntimes("cloudflare-match-coordinator", now, 10);
        const [runtime, futureFixture, overdueFixture] = await Promise.all([
          prisma.matchRuntime.findFirst({
            where: { status: { in: ["QUEUED", "RUNNING", "AWAITING_CHECKPOINT"] } },
            orderBy: { nextActionAt: "asc" },
            select: { nextActionAt: true, leaseExpiresAt: true },
          }),
          prisma.footballMatch.findFirst({
            where: { status: "SCHEDULED", scheduledAt: { gt: now }, runtime: { is: null } },
            orderBy: { scheduledAt: "asc" },
            select: { scheduledAt: true },
          }),
          prisma.footballMatch.findFirst({
            where: { status: "SCHEDULED", scheduledAt: { lte: now }, runtime: { is: null } },
            orderBy: { scheduledAt: "asc" },
            select: { id: true },
          }),
        ]);
        const candidates: number[] = [];
        if (runtime) {
          const nextActionAt = runtime.nextActionAt?.getTime() ?? Date.now() + 10_000;
          candidates.push(Math.max(nextActionAt, runtime.leaseExpiresAt?.getTime() ?? 0));
        }
        if (futureFixture) candidates.push(futureFixture.scheduledAt.getTime());
        if (overdueFixture) candidates.push(now.getTime() + 5_000);
        nextAlarm = candidates.length ? Math.min(...candidates) : null;
      });
    } catch (error) {
      console.error("Match coordinator tick failed", error);
      nextAlarm = Date.now() + 10_000;
    } finally {
      await client.$disconnect();
    }

    if (nextAlarm === null) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(Math.max(Date.now() + 1_000, nextAlarm));
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
      const matches = env.MATCH_COORDINATOR
        ? null
        : await processDueMatchRuntimes("cloudflare-api-scheduled-fallback", now, 10);
      const promotions = await processDuePromotionOffers(now, 50);
      if ((matches && (matches.advanced || matches.settled || matches.failed))
        || promotions.accepted || promotions.completedLeagues) {
        console.info("Cloudflare scheduled game tick", { matches, promotions });
      }
    });
  } finally { await client.$disconnect(); }
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "football-empire-cloudflare-api", mode: "fastify-prisma-runtime", build: "2026-11-16-api-trigger-1" });
    }
    if (request.method === "GET" && url.pathname === "/ready" && missingConfig(env).length) {
      return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing: missingConfig(env) }, 503);
    }
    const response = await handleApi(request, env, ctx);
    if (env.MATCH_COORDINATOR && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())
      && url.pathname.startsWith("/v1/")) {
      const coordinator = env.MATCH_COORDINATOR.get(env.MATCH_COORDINATOR.idFromName("football-empire-match-runtime"));
      ctx.waitUntil(coordinator.fetch("https://match-coordinator/ensure", { method: "POST" }).catch((error: unknown) => {
        console.error("Could not schedule match coordinator alarm", error);
        return new Response(null, { status: 503 });
      }));
    }
    return response;
  },
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledJobs(env).catch((error: unknown) => console.error("Cloudflare scheduled game jobs failed", error)));
  },
};
