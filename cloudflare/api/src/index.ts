import { createPrismaClient, prisma, withPrismaClient } from "../../../apps/api/src/db.js";
import { processDueMatchRuntimes } from "../../../apps/api/src/game/match-service.js";
import { processDuePromotionOffers } from "../../../apps/api/src/game/league-pyramid-service.js";
import { isValidTelegramBotToken, parseAdminTelegramIds, parseCorsOrigins } from "../../../apps/api/src/runtime-config.js";
import { createWorkersApiRouter } from "./workers-router.js";

interface MatchCoordinatorNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> }; }
interface MatchCoordinatorState { storage: { setAlarm(scheduledTime: number): Promise<void>; deleteAlarm(): Promise<void>; }; }
interface Env {
  MATCH_COORDINATOR?: MatchCoordinatorNamespace; DATABASE_URL?: string; HYPERDRIVE?: { connectionString: string };
  TELEGRAM_BOT_TOKEN?: string; BOT_API_SECRET?: string; CORS_ORIGIN?: string; GAME_ADMIN_TELEGRAM_IDS?: string; ENVIRONMENT?: string;
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
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
  } catch { missing.push("CORS_ORIGIN_INVALID"); }
  return missing;
}
function configureEnv(env: Env): void {
  process.env.DATABASE_URL = dbUrl(env) ?? "";
  process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN ?? "";
  process.env.BOT_API_SECRET = env.BOT_API_SECRET ?? "";
  process.env.CORS_ORIGIN = env.CORS_ORIGIN ?? "";
  process.env.GAME_ADMIN_TELEGRAM_IDS = env.GAME_ADMIN_TELEGRAM_IDS ?? "";
}
const api = createWorkersApiRouter();

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const missing = missingConfig(env);
  if (missing.length) return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing }, 503);
  let client: ReturnType<typeof createPrismaClient>;
  try { client = createPrismaClient(dbUrl(env) ?? undefined, 1); }
  catch { return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing: ["DATABASE_CONFIGURATION"] }, 503); }
  let cleanupScheduled = false;
  try {
    const response = await withPrismaClient(client, () => api.fetch(request));
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

function describeRuntimeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error, message: String(error).slice(0, 600) };
  const candidate = error as Error & { code?: unknown; meta?: unknown };
  const redact = (value: unknown) => String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-database-url]")
    .slice(0, 800);
  const meta = candidate.meta && typeof candidate.meta === "object"
    ? Object.fromEntries(Object.entries(candidate.meta as Record<string, unknown>)
      .filter(([key, value]) => ["modelName", "table", "column", "constraint", "code", "field_name"].includes(key)
        && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
      .map(([key, value]) => [key, redact(value)]))
    : undefined;
  return {
    name: error.name,
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message: redact(error.message),
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
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
      return json({ status: "ok", service: "football-empire-cloudflare-api", mode: "hono-prisma-runtime", build: "2026-11-16-hono-router-1" });
    }
    configureEnv(env);
    if (request.method === "OPTIONS") return api.fetch(request);
    if (request.method === "GET" && url.pathname === "/ready") {
      const missing = missingConfig(env);
      if (missing.length) return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing }, 503);
      const client = createPrismaClient(dbUrl(env) ?? undefined, 1);
      try {
        await withPrismaClient(client, () => prisma.$queryRaw`SELECT 1`);
        ctx.waitUntil(client.$disconnect().catch((error: unknown) => console.error("Prisma readiness cleanup failed", error)));
        return json({ status: "ready", service: "football-empire-api", database: "connected" });
      } catch (error) {
        console.error("Cloudflare API readiness database check failed", error);
        await client.$disconnect().catch(() => undefined);
        return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing: ["DATABASE_CONNECTION"] }, 503);
      }
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
    ctx.waitUntil(scheduledJobs(env).catch((error: unknown) => console.error("Cloudflare scheduled game jobs failed", describeRuntimeError(error))));
  },
};
