import { createPrismaClient, prisma, withPrismaClient } from "../../../apps/api/src/db.js";
import { processDueMatchRuntimes } from "../../../apps/api/src/game/match-service.js";
import { processDueEventTournamentFinalizations } from "../../../apps/api/src/event-tournament-service.js";
import { processDuePromotionOffers } from "../../../apps/api/src/game/league-pyramid-service.js";
import { isValidTelegramBotToken, parseAdminTelegramIds, parseCorsOrigins } from "../../../apps/api/src/runtime-config.js";
import { createWorkersApiRouter } from "./workers-router.js";

interface MatchCoordinatorNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> }; }
interface MatchCoordinatorState { storage: { setAlarm(scheduledTime: number): Promise<void>; deleteAlarm(): Promise<void>; }; }
interface Env {
  MATCH_COORDINATOR?: MatchCoordinatorNamespace; DATABASE_URL?: string; HYPERDRIVE?: { connectionString: string };
  TELEGRAM_BOT_TOKEN?: string; BOT_API_SECRET?: string; CORS_ORIGIN?: string; GAME_ADMIN_TELEGRAM_IDS?: string;
  ALLIANCE_REVIEWER_TELEGRAM_IDS?: string; GAME_ADMIN_ROLE_MAP?: string; ENVIRONMENT?: string;
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
  process.env.ENVIRONMENT = env.ENVIRONMENT ?? "production";
  process.env.DATABASE_URL = dbUrl(env) ?? "";
  process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN ?? "";
  process.env.BOT_API_SECRET = env.BOT_API_SECRET ?? "";
  process.env.CORS_ORIGIN = env.CORS_ORIGIN ?? "";
  process.env.GAME_ADMIN_TELEGRAM_IDS = env.GAME_ADMIN_TELEGRAM_IDS ?? "";
  process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS = env.ALLIANCE_REVIEWER_TELEGRAM_IDS ?? "";
  process.env.GAME_ADMIN_ROLE_MAP = env.GAME_ADMIN_ROLE_MAP ?? "";
}
const api = createWorkersApiRouter();

const allowedPilotEvents = new Set(["bot_start", "bot_command", "bot_callback", "bot_update", "miniapp_session"]);
function constantTimeSecretEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (!a.length || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i]! ^ b[i]!;
  return mismatch === 0;
}


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
        const tournamentFinalizations = await processDueEventTournamentFinalizations(now, 1);
        await deliverDueMatchLifecycle(this.env);
        const [runtime, futureFixture, overdueFixture, lifecycleNotification, resultNotification, pendingTournamentFinalization] = await Promise.all([
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
          prisma.matchLifecycleNotification.findFirst({
            where: { status: "PENDING" },
            orderBy: { availableAt: "asc" },
            select: { availableAt: true, lockedUntil: true },
          }),
          prisma.matchResultNotification.findFirst({
            where: { status: "PENDING" },
            orderBy: { availableAt: "asc" },
            select: { availableAt: true, lockedUntil: true },
          }),
          prisma.eventTournament.findFirst({
            where: { status: "ACTIVE", competition: { is: { status: "COMPLETED" } } },
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
        if (lifecycleNotification) candidates.push(Math.max(now.getTime() + 1_000, lifecycleNotification.availableAt.getTime(), lifecycleNotification.lockedUntil?.getTime() ?? 0));
        if (resultNotification) candidates.push(Math.max(now.getTime() + 1_000, resultNotification.availableAt.getTime(), resultNotification.lockedUntil?.getTime() ?? 0));
        if (pendingTournamentFinalization) candidates.push(now.getTime() + 10_000);
        if (tournamentFinalizations.failed) console.error("Tournament finalization retries remain pending", tournamentFinalizations);
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

function escapeTelegramHtml(value: unknown): string { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function deliverDueMatchLifecycle(env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return;
  const now = new Date();
  const rows = await prisma.matchLifecycleNotification.findMany({
    where: { status: "PENDING", availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now.getTime() - 30_000) } }] },
    include: { match: { select: { homeClub: { select: { name: true } }, awayClub: { select: { name: true } } } } },
    orderBy: { availableAt: "asc" }, take: 50,
  });
  for (const row of rows) {
    const claimToken = crypto.randomUUID();
    const claim = await prisma.matchLifecycleNotification.updateMany({ where: { id: row.id, status: "PENDING", availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now.getTime() - 30_000) } }] }, data: { claimToken, lockedUntil: new Date(now.getTime() + 30_000), attempts: { increment: 1 } } });
    if (claim.count !== 1) continue;
    const home = escapeTelegramHtml(row.match.homeClub.name);
    const away = escapeTelegramHtml(row.match.awayClub.name);
    const score = "\n<b>" + home + "</b> " + row.homeScore + " : " + row.awayScore + " <b>" + away + "</b>";
    const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
    const message = row.kind === "KICKOFF" ? "⚽ <b>سوت آغاز مسابقه</b>" + score
      : row.kind === "HALF_TIME" ? "⏸ <b>پایان نیمه اول</b> · دقیقه ۴۵" + score
      : "⚽ <b>گل!</b> · دقیقه " + row.minute + "\n" + escapeTelegramHtml(payload.teamName ?? "تیم") + " · " + escapeTelegramHtml(payload.scorerName ?? "بازیکن") + score;
    try {
      const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: row.telegramChatId, text: message, parse_mode: "HTML" }) });
      const body = await response.json() as { ok?: boolean };
      const delivered = response.ok && body.ok === true;
      await prisma.matchLifecycleNotification.updateMany({ where: { id: row.id, status: "PENDING", claimToken }, data: delivered ? { status: "DELIVERED", deliveredAt: new Date(), claimToken: null, lockedUntil: null } : { availableAt: new Date(Date.now() + 15_000), claimToken: null, lockedUntil: null, lastError: "TELEGRAM_SEND_FAILED" } });
    } catch (error) {
      await prisma.matchLifecycleNotification.updateMany({ where: { id: row.id, status: "PENDING", claimToken }, data: { availableAt: new Date(Date.now() + 15_000), claimToken: null, lockedUntil: null, lastError: error instanceof Error ? error.message.slice(0, 500) : "TELEGRAM_SEND_FAILED" } });
    }
  }
  const results = await prisma.matchResultNotification.findMany({
    where: { status: "PENDING", availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now.getTime() - 30_000) } }], match: { status: "COMPLETED" } },
    include: { match: { include: { homeClub: { select: { id: true, name: true } }, awayClub: { select: { id: true, name: true } }, performances: { include: { player: { select: { firstName: true, lastName: true } } } } } } },
    orderBy: { createdAt: "asc" }, take: 50,
  });
  for (const row of results) {
    const claimToken = crypto.randomUUID();
    const claim = await prisma.matchResultNotification.updateMany({ where: { id: row.id, status: "PENDING", availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now.getTime() - 30_000) } }] }, data: { claimToken, lockedUntil: new Date(now.getTime() + 30_000), attempts: { increment: 1 } } });
    if (claim.count !== 1) continue;
    const match = row.match;
    const homeStats = match.performances.filter((line) => line.clubId === match.homeClub.id);
    const awayStats = match.performances.filter((line) => line.clubId === match.awayClub.id);
    const sum = (items: typeof match.performances, key: "shots" | "passes" | "tackles") => items.reduce((total, item) => total + item[key], 0);
    const scorers = match.performances.filter((line) => line.goals > 0).sort((a, b) => b.goals - a.goals).map((line) => escapeTelegramHtml(line.player.firstName + " " + line.player.lastName) + " · " + line.goals + " گل").join("\n");
    const message = "🏁 <b>پایان مسابقه</b>\n<b>" + escapeTelegramHtml(match.homeClub.name) + "</b> " + match.homeScore + " : " + match.awayScore + " <b>" + escapeTelegramHtml(match.awayClub.name) + "</b>"
      + "\n\n📊 <b>آمار مسابقه</b>"
      + "\nشوت‌ها: " + sum(homeStats, "shots") + " - " + sum(awayStats, "shots")
      + "\nپاس‌ها: " + sum(homeStats, "passes") + " - " + sum(awayStats, "passes")
      + "\nتکل‌ها: " + sum(homeStats, "tackles") + " - " + sum(awayStats, "tackles")
      + (scorers ? "\n\n⚽ <b>گلزنان</b>\n" + scorers : "\n\n⚽ بدون گل");
    try {
      const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: row.telegramChatId, text: message, parse_mode: "HTML" }) });
      const body = await response.json() as { ok?: boolean };
      const delivered = response.ok && body.ok === true;
      await prisma.matchResultNotification.updateMany({ where: { id: row.id, status: "PENDING", claimToken }, data: delivered ? { status: "DELIVERED", deliveredAt: new Date(), claimToken: null, lockedUntil: null } : { availableAt: new Date(Date.now() + 15_000), claimToken: null, lockedUntil: null, lastError: "TELEGRAM_SEND_FAILED" } });
    } catch (error) {
      await prisma.matchResultNotification.updateMany({ where: { id: row.id, status: "PENDING", claimToken }, data: { availableAt: new Date(Date.now() + 15_000), claimToken: null, lockedUntil: null, lastError: error instanceof Error ? error.message.slice(0, 500) : "TELEGRAM_SEND_FAILED" } });
    }
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
      const tournamentFinalizations = await processDueEventTournamentFinalizations(now, 1);
      await deliverDueMatchLifecycle(env);
      const promotions = await processDuePromotionOffers(now, 50);
      if ((matches && (matches.advanced || matches.settled || matches.failed))
        || tournamentFinalizations.finalized || tournamentFinalizations.failed
        || promotions.accepted || promotions.completedLeagues) {
        console.info("Cloudflare scheduled game tick", { matches, tournamentFinalizations, promotions });
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
    if (url.pathname === "/internal/pilot/events") {
      if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      const supplied = request.headers.get("x-football-bot-secret") ?? "";
      if (!env.BOT_API_SECRET || !constantTimeSecretEqual(supplied, env.BOT_API_SECRET)) return json({ error: "UNAUTHORIZED" }, 401);
      const length = Number(request.headers.get("content-length") ?? "0");
      if (Number.isFinite(length) && length > 4096) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 4096) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
      let event: { eventName?: unknown; userKey?: unknown; actionKey?: unknown; chatType?: unknown; source?: unknown };
      try { event = JSON.parse(raw) as typeof event; } catch { return json({ error: "INVALID_JSON" }, 400); }
      if (typeof event.eventName !== "string" || !allowedPilotEvents.has(event.eventName)
        || typeof event.userKey !== "string" || !/^[a-f0-9]{32}$/.test(event.userKey)
        || (event.actionKey !== undefined && (typeof event.actionKey !== "string" || event.actionKey.length > 64 || !/^[a-z0-9_-]*$/i.test(event.actionKey)))
        || (event.chatType !== undefined && !["private", "group", "supergroup", "channel", "unknown"].includes(String(event.chatType)))
        || !["bot", "miniapp"].includes(String(event.source))) return json({ error: "INVALID_EVENT" }, 400);
      const client = createPrismaClient(dbUrl(env) ?? undefined, 1);
      try {
        await withPrismaClient(client, () => prisma.$executeRaw`
          INSERT INTO "PilotAnalyticsEvent" ("eventName", "userKey", "actionKey", "chatType", "source")
          VALUES (${event.eventName}, ${event.userKey}, ${typeof event.actionKey === "string" ? event.actionKey : ""}, ${typeof event.chatType === "string" ? event.chatType : "unknown"}, ${String(event.source)})
        `);
        ctx.waitUntil(client.$disconnect().catch((error: unknown) => console.error("Pilot analytics cleanup failed", error)));
        return json({ accepted: true }, 202);
      } catch (error) {
        await client.$disconnect().catch(() => undefined);
        console.error("Pilot analytics persistence failed", error);
        return json({ error: "ANALYTICS_UNAVAILABLE" }, 503);
      }
    }
    configureEnv(env);
    if (request.method === "OPTIONS") return api.fetch(request);
    if (request.method === "GET" && url.pathname === "/ready") {
      const missing = missingConfig(env);
      if (missing.length) return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing }, 503);
      const client = createPrismaClient(dbUrl(env) ?? undefined, 1);
      try {
        const schemaChecks = await withPrismaClient(client, () => prisma.$queryRaw<Array<{ ready: boolean }>>`
          SELECT
            (
              SELECT count(*) = 10
              FROM "_prisma_migrations"
              WHERE migration_name IN (
                '20261116120000_in_game_store',
                '20261117100000_lock_down_public_api',
                '20261117110000_index_foreign_key_columns',
                '20261117120000_restore_alliance_foreign_keys',
                '20261117180000_event_tournaments',
                '20261117200000_match_lifecycle_notifications',
                '20261117210000_league_round_notice_dedupe',
                '20261117220000_event_tournament_competitions',
                '20261117230000_event_tournament_default_capacity',
                '20261117240000_event_tournament_fk_indexes'
              )
                AND finished_at IS NOT NULL
                AND rolled_back_at IS NULL
            )
            AND to_regclass('"PyramidLeague"') IS NOT NULL
            AND to_regclass('"LeaguePromotionOffer"') IS NOT NULL
            AND to_regclass('"EventTournament"') IS NOT NULL
            AND to_regclass('"EventTournamentParticipant"') IS NOT NULL
            AND to_regclass('"EventTournamentPrize"') IS NOT NULL
            AND to_regclass('"EventTournamentPrizeAward"') IS NOT NULL
            AND to_regclass('"MatchLifecycleNotification"') IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'LeagueNotice'
                AND column_name = 'dedupeKey'
            )
            AND (SELECT count(*) >= 15 FROM "SpecialPlayer" WHERE active = true)
            AND EXISTS (
              SELECT 1 FROM pg_roles
              WHERE rolname = current_user
                AND (rolsuper OR rolbypassrls)
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind IN ('r', 'p')
                AND NOT c.relrowsecurity
            )
            AND NOT EXISTS (
              SELECT 1
              FROM information_schema.role_table_grants
              WHERE table_schema = 'public'
                AND grantee IN ('anon', 'authenticated')
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public'
                AND c.relkind = 'S'
                AND (
                  has_sequence_privilege('anon', c.oid, 'USAGE')
                  OR has_sequence_privilege('anon', c.oid, 'SELECT')
                  OR has_sequence_privilege('anon', c.oid, 'UPDATE')
                  OR has_sequence_privilege('authenticated', c.oid, 'USAGE')
                  OR has_sequence_privilege('authenticated', c.oid, 'SELECT')
                  OR has_sequence_privilege('authenticated', c.oid, 'UPDATE')
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND (
                  has_function_privilege('anon', p.oid, 'EXECUTE')
                  OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                )
            ) AS ready
        `);
        if (!schemaChecks[0]?.ready) {
          ctx.waitUntil(client.$disconnect().catch((error: unknown) => console.error("Prisma readiness cleanup failed", error)));
          return json({
            status: "not_ready",
            service: "football-empire-api",
            database: "connected",
            missing: ["DATABASE_SCHEMA_MIGRATIONS"],
          }, 503);
        }
        ctx.waitUntil(client.$disconnect().catch((error: unknown) => console.error("Prisma readiness cleanup failed", error)));
        return json({ status: "ready", service: "football-empire-api", database: "connected", schema: "current" });
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
