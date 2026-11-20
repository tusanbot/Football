import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "./auth/require-telegram-user.js";
import { parseAdminTelegramIds } from "./runtime-config.js";
import type { AdminRoleAssignment, AdminRoleLookupPort } from "./admin-role-context.js";
import type { AdminPyramidLeagueReadPort } from "./node-supabase-admin-pyramid-league-read.js";
import type { AdminPyramidLeagueReportsPort } from "./node-supabase-admin-pyramid-league-reports.js";
import type { AdminPyramidLeagueActionsPort } from "./node-supabase-admin-pyramid-league-actions.js";
import type { AdminAlliancePort } from "./groups/node-supabase-alliance.js";

type Permission = "read" | "competitions";
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  superadmin: ["read", "competitions"],
  football: ["read", "competitions"],
  economy: ["read"],
  moderator: ["read"],
};

async function roleFor(telegramId: string, port?: AdminRoleLookupPort) {
  const superAdmins = parseAdminTelegramIds(process.env.GAME_ADMIN_TELEGRAM_IDS);
  if (superAdmins.includes(telegramId)) return "superadmin";
  if (!port) throw new Error("ADMIN_ROLE_SUPABASE_REPOSITORY_REQUIRED");
  const assigned: AdminRoleAssignment | null = await port.getAssignment(telegramId);
  if (assigned) {
    return assigned.active && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, assigned.role)
      ? assigned.role : null;
  }
  try {
    const roles = JSON.parse(process.env.GAME_ADMIN_ROLE_MAP ?? "{}") as Record<string, string>;
    return roles[telegramId] && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, roles[telegramId]!)
      ? roles[telegramId]! : null;
  } catch { return null; }
}

async function authorize(request: FastifyRequest, reply: FastifyReply, permission: Permission, port?: AdminRoleLookupPort) {
  const user = await requireTelegramUser(request);
  if (!user) {
    reply.code(401).send({ error: "UNAUTHENTICATED" });
    return null;
  }
  const role = await roleFor(user.telegramId, port);
  if (!role || !ROLE_PERMISSIONS[role]?.includes(permission)) {
    reply.code(403).send({ error: "ADMIN_PERMISSION_REQUIRED", permission });
    return null;
  }
  return user;
}

const filters = z.object({
  season: z.coerce.number().int().min(2020).max(2200).optional(),
  tier: z.coerce.number().int().min(1).max(7).optional(),
  status: z.enum(["DRAFT", "REGISTRATION", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

export function registerAdminLeagueRoutes(app: FastifyInstance, options: { adminAlliancePort?: AdminAlliancePort; adminRoleLookupPort?: AdminRoleLookupPort; adminPyramidLeagueReadPort?: AdminPyramidLeagueReadPort; adminPyramidLeagueReportsPort?: AdminPyramidLeagueReportsPort; adminPyramidLeagueActionsPort?: AdminPyramidLeagueActionsPort } = {}) {
  const authorizeAdmin = (request: FastifyRequest, reply: FastifyReply, permission: Permission) => authorize(request, reply, permission, options.adminRoleLookupPort);
  app.get("/v1/admin/pyramid-leagues", async (request, reply) => {
    const actor = await authorizeAdmin(request, reply, "read");
    if (!actor) return;
    const parsed = filters.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const { season, tier, status, q, limit } = parsed.data;
    if (options.adminPyramidLeagueReadPort) return options.adminPyramidLeagueReadPort.list({ ...(season !== undefined ? { season } : {}), ...(tier !== undefined ? { tier } : {}), ...(status !== undefined ? { status } : {}), ...(q !== undefined ? { q } : {}), limit });
    throw new Error("ADMIN_PYRAMID_LEAGUE_READ_SUPABASE_REPOSITORY_REQUIRED");
  });


  app.get("/v1/admin/pyramid-leagues/reports", async (request, reply) => {
    const actor = await authorizeAdmin(request, reply, "read");
    if (!actor) return;
    const parsed = z.object({
      season: z.coerce.number().int().min(2020).max(2200).optional(),
      tier: z.coerce.number().int().min(1).max(7).optional(),
      q: z.string().trim().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(100),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const { season, tier, q, limit } = parsed.data;
    if (options.adminPyramidLeagueReportsPort) return options.adminPyramidLeagueReportsPort.getReports({ ...(season !== undefined ? { season } : {}), ...(tier !== undefined ? { tier } : {}), ...(q !== undefined ? { q } : {}), limit });
    throw new Error("ADMIN_PYRAMID_LEAGUE_REPORTS_SUPABASE_REPOSITORY_REQUIRED");
  });

  app.post("/v1/admin/pyramid-leagues/actions", async (request, reply) => {
    const actor = await authorizeAdmin(request, reply, "competitions");
    if (!actor) return;
    if (!options.adminAlliancePort) throw new Error("ADMIN_ALLIANCE_RATE_LIMIT_SUPABASE_REPOSITORY_REQUIRED");
    if (!await options.adminAlliancePort.consumeRateLimit({ telegramUserId: actor.telegramId, telegramGroupId: "global", action: "admin-pyramid-actions", limit: 20, now: new Date().toISOString() })) return reply.code(429).send({ error: "ADMIN_RATE_LIMITED", retryAfterSeconds: 60 });
    const parsed = z.object({
      action: z.enum(["league-status", "withdraw-application", "extend-promotion-deadline", "update-award"]),
      targetId: z.string().min(1).max(128),
      status: z.literal("CANCELLED").optional(),
      hours: z.number().int().min(1).max(72).optional(),
      awardName: z.string().trim().min(2).max(80).optional(),
      awardType: z.string().trim().min(2).max(40).optional(),
      reason: z.string().trim().min(3).max(500).optional(),
      idempotencyKey: z.string().min(12).max(128),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_ADMIN_ACTION" });
    const input = parsed.data;
    if (options.adminPyramidLeagueActionsPort) {
      try {
        return await options.adminPyramidLeagueActionsPort.execute({
          action: input.action, targetId: input.targetId, actorTelegramId: actor.telegramId,
          idempotencyKey: input.idempotencyKey,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.hours !== undefined ? { hours: input.hours } : {}),
          ...(input.awardName !== undefined ? { awardName: input.awardName } : {}),
          ...(input.awardType !== undefined ? { awardType: input.awardType } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "ADMIN_ACTION_FAILED";
        if (message.includes("TARGET_NOT_FOUND") || message.includes("PENDING_OFFER_NOT_FOUND")) return reply.code(404).send({ error: message });
        if (["STATUS_REQUIRED","HOURS_REQUIRED","AWARD_FIELDS_REQUIRED","COMPLETED_LEAGUE_LOCKED","QUEUED_APPLICATION_NOT_FOUND","PYRAMID_LEAGUE_STATUS_MANAGED_AUTOMATICALLY","IDEMPOTENCY_KEY_REUSED"].some(code=>message.includes(code))) return reply.code(409).send({ error: message });
        if (message.includes("INVALID_ADMIN_ACTION")) return reply.code(400).send({ error: message });
        throw error;
      }
    }
    throw new Error("ADMIN_PYRAMID_LEAGUE_ACTIONS_SUPABASE_REPOSITORY_REQUIRED");
  });
}
