import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireTelegramUser } from "./auth/require-telegram-user.js";

type Permission = "read" | "competitions";
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  superadmin: ["read", "competitions"],
  football: ["read", "competitions"],
  economy: ["read"],
  moderator: ["read"],
};

async function roleFor(telegramId: string) {
  const superAdmins = (process.env.GAME_ADMIN_TELEGRAM_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (superAdmins.includes(telegramId)) return "superadmin";
  // Database assignments are authoritative, including inactive rows that revoke
  // an environment-provisioned scoped role. Keep this in sync with admin-routes.
  const assigned = await prisma.adminRoleAssignment.findUnique({
    where: { telegramId },
    select: { role: true, active: true },
  });
  if (assigned) {
    return assigned.active && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, assigned.role)
      ? assigned.role
      : null;
  }
  try {
    const roles = JSON.parse(process.env.GAME_ADMIN_ROLE_MAP ?? "{}") as Record<string, string>;
    return roles[telegramId] && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, roles[telegramId]!)
      ? roles[telegramId]!
      : null;
  } catch {
    return null;
  }
}

async function authorize(request: FastifyRequest, reply: FastifyReply, permission: Permission) {
  const user = await requireTelegramUser(request);
  if (!user) {
    reply.code(401).send({ error: "UNAUTHENTICATED" });
    return null;
  }
  const role = await roleFor(user.telegramId);
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

export function registerAdminLeagueRoutes(app: FastifyInstance) {
  app.get("/v1/admin/pyramid-leagues", async (request, reply) => {
    const actor = await authorize(request, reply, "read");
    if (!actor) return;
    const parsed = filters.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const { season, tier, status, q, limit } = parsed.data;
    const where = {
      ...(season ? { season } : {}),
      ...(tier ? { tier } : {}),
      ...(status ? { competition: { status } } : {}),
      ...(q ? { competition: { ...(status ? { status } : {}), name: { contains: q, mode: "insensitive" as const } } } : {}),
    };
    const [leagues, queues, offers, totals] = await Promise.all([
      prisma.pyramidLeague.findMany({
        where, take: limit, orderBy: [{ season: "desc" }, { tier: "asc" }, { groupNumber: "asc" }],
        include: {
          competition: {
            select: {
              id: true, name: true, status: true, startsAt: true, completedAt: true,
              entries: { orderBy: [{ points: "desc" }, { goalsFor: "desc" }], include: { club: { select: { id: true, name: true } } } },
              _count: { select: { matches: true } },
            },
          },
          entries: { include: { club: { select: { id: true, name: true, ownerId: true } } } },
          awards: { include: { club: { select: { name: true } } }, orderBy: { placement: "asc" } },
          promotionOffers: { include: { club: { select: { id: true, name: true } } }, orderBy: { offeredAt: "desc" } },
        },
      }),
      prisma.pyramidLeagueApplication.findMany({
        where: { status: "QUEUED", ...(season ? { season } : {}), ...(tier ? { tier } : {}), ...(q ? { club: { is: { name: { contains: q, mode: "insensitive" as const } } } } : {}) },
        take: limit, orderBy: [{ appliedAt: "asc" }, { id: "asc" }],
        include: { club: { select: { id: true, name: true } }, user: { select: { displayName: true, telegramId: true } } },
      }),
      prisma.leaguePromotionOffer.findMany({
        where: { ...(season ? { league: { season } } : {}), ...(tier ? { league: { tier } } : {}), ...(q ? { club: { is: { name: { contains: q, mode: "insensitive" as const } } } } : {}) },
        take: limit, orderBy: { offeredAt: "desc" },
        include: { club: { select: { id: true, name: true } }, league: { select: { tier: true, season: true, groupNumber: true, competition: { select: { name: true } } } } },
      }),
      prisma.pyramidLeagueApplication.groupBy({ by: ["status"], where: { ...(season ? { season } : {}), ...(tier ? { tier } : {}) }, _count: { _all: true } }),
    ]);
    return {
      leagues: leagues.map((league) => ({
        id: league.id, competitionId: league.competition.id, tier: league.tier, season: league.season,
        groupNumber: league.groupNumber, promotionProcessedAt: league.promotionProcessedAt?.toISOString() ?? null,
        name: league.competition.name, status: league.competition.status,
        startsAt: league.competition.startsAt?.toISOString() ?? null, completedAt: league.competition.completedAt?.toISOString() ?? null,
        matchCount: league.competition._count.matches,
        teams: league.entries.map((entry) => ({ id: entry.club.id, name: entry.club.name, ownerId: entry.club.ownerId, finalPosition: entry.finalPosition })),
        standings: league.competition.entries.map((entry, index) => ({ position: index + 1, clubId: entry.clubId, clubName: entry.club.name, played: entry.played, won: entry.won, drawn: entry.drawn, lost: entry.lost, goalsFor: entry.goalsFor, goalsAgainst: entry.goalsAgainst, points: entry.points })),
        awards: league.awards.map((award) => ({ id: award.id, placement: award.placement, awardName: award.awardName, awardType: award.awardType, clubName: award.club.name })),
        promotionOffers: league.promotionOffers.map((offer) => ({ id: offer.id, clubId: offer.clubId, clubName: offer.club.name, targetTier: offer.targetTier, finalPosition: offer.finalPosition, status: offer.status, expiresAt: offer.expiresAt.toISOString() })),
      })),
      queues: queues.map((item) => ({ id: item.id, tier: item.tier, season: item.season, appliedAt: item.appliedAt.toISOString(), club: item.club, user: item.user })),
      offers: offers.map((offer) => ({ id: offer.id, club: offer.club, tier: offer.league.tier, season: offer.league.season, groupNumber: offer.league.groupNumber, leagueName: offer.league.competition.name, targetTier: offer.targetTier, finalPosition: offer.finalPosition, status: offer.status, offeredAt: offer.offeredAt.toISOString(), expiresAt: offer.expiresAt.toISOString() })),
      applicationCounts: Object.fromEntries(totals.map((row) => [row.status, row._count._all])),
    };
  });


  app.get("/v1/admin/pyramid-leagues/reports", async (request, reply) => {
    const actor = await authorize(request, reply, "read");
    if (!actor) return;
    const parsed = z.object({
      season: z.coerce.number().int().min(2020).max(2200).optional(),
      tier: z.coerce.number().int().min(1).max(7).optional(),
      q: z.string().trim().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(100),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const { season, tier, q, limit } = parsed.data;
    const leagueWhere = {
      ...(season ? { season } : {}),
      ...(tier ? { tier } : {}),
      ...(q ? { OR: [
        { competition: { is: { name: { contains: q, mode: "insensitive" as const } } } },
        { entries: { some: { club: { is: { name: { contains: q, mode: "insensitive" as const } } } } } },
      ] } : {}),
    };
    const [leagues, auditLogs, applicationCounts] = await Promise.all([
      prisma.pyramidLeague.findMany({
        where: leagueWhere,
        take: 1000,
        orderBy: [{ season: "desc" }, { tier: "asc" }, { groupNumber: "asc" }],
        include: {
          competition: { select: { name: true, status: true, completedAt: true, _count: { select: { matches: true } } } },
          entries: { include: { club: { select: { id: true, name: true } } } },
          awards: { include: { club: { select: { id: true, name: true } } }, orderBy: { placement: "asc" } },
          promotionOffers: { include: { club: { select: { id: true, name: true } } }, orderBy: { offeredAt: "asc" } },
        },
      }),
      prisma.adminAuditLog.findMany({
        where: {
          targetType: { in: ["pyramid-league", "league-application", "promotion-offer", "league-award"] },
          ...(q ? { OR: [
            { action: { contains: q, mode: "insensitive" as const } },
            { targetId: { contains: q, mode: "insensitive" as const } },
            { reason: { contains: q, mode: "insensitive" as const } },
          ] } : {}),
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.pyramidLeagueApplication.groupBy({
        by: ["status"],
        where: { ...(season ? { season } : {}), ...(tier ? { tier } : {}) },
        _count: { _all: true },
      }),
    ]);
    const seasons = new Map<number, { season: number; leagues: number; completed: number; teams: number; matches: number; champions: number; promotions: number; relegations: number }>();
    const clubs = new Map<string, { clubId: string; clubName: string; seasons: number; championships: number; podiums: number; promotions: number; relegations: number; leagueEntries: number }>();
    const movements: Array<{ clubId: string; clubName: string; season: number; tier: number; groupNumber: number; position: number; movement: "PROMOTION" | "RELEGATION"; offerStatus?: string }> = [];
    for (const league of leagues) {
      let summary = seasons.get(league.season);
      if (!summary) {
        summary = { season: league.season, leagues: 0, completed: 0, teams: 0, matches: 0, champions: 0, promotions: 0, relegations: 0 };
        seasons.set(league.season, summary);
      }
      summary.leagues += 1;
      if (league.competition.status === "COMPLETED") {
        summary.completed += 1;
        summary.teams += league.entries.length;
        summary.matches += league.competition._count.matches;
      }
      for (const entry of league.entries) {
        let record = clubs.get(entry.clubId);
        if (!record) {
          record = { clubId: entry.clubId, clubName: entry.club.name, seasons: 0, championships: 0, podiums: 0, promotions: 0, relegations: 0, leagueEntries: 0 };
          clubs.set(entry.clubId, record);
        }
        if (league.competition.status === "COMPLETED" && entry.finalPosition !== null) {
          record.leagueEntries += 1;
          record.seasons += 1;
          if (entry.finalPosition === 1) {
            record.championships += 1;
            summary.champions += 1;
          }
          if (entry.finalPosition <= 3) record.podiums += 1;
          if (league.tier > 1 && entry.finalPosition >= 7) {
            record.relegations += 1;
            summary.relegations += 1;
            movements.push({ clubId: entry.clubId, clubName: entry.club.name, season: league.season, tier: league.tier, groupNumber: league.groupNumber, position: entry.finalPosition, movement: "RELEGATION" });
          }
        }
      }
      for (const offer of league.promotionOffers) {
        if (offer.status === "ACCEPTED") {
          const record = clubs.get(offer.clubId);
          if (record) record.promotions += 1;
          summary.promotions += 1;
          movements.push({ clubId: offer.clubId, clubName: offer.club.name, season: league.season, tier: league.tier, groupNumber: league.groupNumber, position: offer.finalPosition, movement: "PROMOTION", offerStatus: offer.status });
        }
      }
    }
    const clubRankings = [...clubs.values()]
      .sort((a, b) => b.championships - a.championships || b.podiums - a.podiums || b.promotions - a.promotions || a.relegations - b.relegations || a.clubName.localeCompare(b.clubName))
      .slice(0, 50);
    const leagueHistory = leagues.map((league) => ({
      id: league.id, name: league.competition.name, season: league.season, tier: league.tier,
      groupNumber: league.groupNumber, status: league.competition.status,
      completedAt: league.competition.completedAt?.toISOString() ?? null,
      champion: league.entries.find((entry) => entry.finalPosition === 1)?.club.name ?? null,
      runnerUp: league.entries.find((entry) => entry.finalPosition === 2)?.club.name ?? null,
      relegated: league.entries.filter((entry) => league.tier > 1 && entry.finalPosition !== null && entry.finalPosition >= 7).map((entry) => entry.club.name),
      promotions: league.promotionOffers.map((offer) => ({ clubName: offer.club.name, position: offer.finalPosition, targetTier: offer.targetTier, status: offer.status })),
      awards: league.awards.map((award) => ({ clubName: award.club.name, placement: award.placement, awardName: award.awardName })),
    }));
    return {
      totals: {
        leagues: leagues.length,
        completedLeagues: leagues.filter((league) => league.competition.status === "COMPLETED").length,
        seasons: seasons.size,
        clubs: clubs.size,
        promotions: movements.filter((movement) => movement.movement === "PROMOTION").length,
        relegations: movements.filter((movement) => movement.movement === "RELEGATION").length,
      },
      seasons: [...seasons.values()].sort((a, b) => b.season - a.season),
      clubRankings,
      movements: movements.sort((a, b) => b.season - a.season || a.tier - b.tier || a.position - b.position).slice(0, 200),
      leagueHistory,
      auditLogs: auditLogs.map((log) => ({
        id: log.id, actorTelegramId: log.actorTelegramId, action: log.action, targetType: log.targetType,
        targetId: log.targetId, reason: log.reason, createdAt: log.createdAt.toISOString(),
      })),
      applicationCounts: Object.fromEntries(applicationCounts.map((row) => [row.status, row._count._all])),
    };
  });

  app.post("/v1/admin/pyramid-leagues/actions", async (request, reply) => {
    const actor = await authorize(request, reply, "competitions");
    if (!actor) return;
    const parsed = z.object({
      action: z.enum(["league-status", "withdraw-application", "extend-promotion-deadline", "update-award"]),
      targetId: z.string().min(1).max(128),
      status: z.enum(["ACTIVE", "CANCELLED"]).optional(),
      hours: z.number().int().min(1).max(72).optional(),
      awardName: z.string().trim().min(2).max(80).optional(),
      awardType: z.string().trim().min(2).max(40).optional(),
      reason: z.string().trim().min(3).max(500).optional(),
      idempotencyKey: z.string().min(12).max(128),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_ADMIN_ACTION" });
    const input = parsed.data;
    try {
      const result = await prisma.$transaction(async (tx) => {
        let targetType = "";
        let targetId = input.targetId;
        if (input.action === "league-status") {
          if (!input.status) throw new Error("STATUS_REQUIRED");
          const league = await tx.pyramidLeague.findUnique({ where: { id: input.targetId }, include: { competition: { include: { _count: { select: { entries: true } } } } } });
          if (!league) throw new Error("TARGET_NOT_FOUND");
          if (input.status === "ACTIVE" && league.competition._count.entries !== 8) throw new Error("LEAGUE_MUST_HAVE_EIGHT_TEAMS");
          if (league.competition.status === "COMPLETED") throw new Error("COMPLETED_LEAGUE_LOCKED");
          await tx.competition.update({ where: { id: league.competitionId }, data: { status: input.status } });
          targetType = "pyramid-league";
        } else if (input.action === "withdraw-application") {
          const updated = await tx.pyramidLeagueApplication.updateMany({ where: { id: input.targetId, status: "QUEUED" }, data: { status: "WITHDRAWN" } });
          if (!updated.count) throw new Error("QUEUED_APPLICATION_NOT_FOUND");
          targetType = "league-application";
        } else if (input.action === "extend-promotion-deadline") {
          if (!input.hours) throw new Error("HOURS_REQUIRED");
          const offer = await tx.leaguePromotionOffer.findUnique({ where: { id: input.targetId } });
          if (!offer || offer.status !== "PENDING") throw new Error("PENDING_OFFER_NOT_FOUND");
          await tx.leaguePromotionOffer.update({ where: { id: offer.id }, data: { expiresAt: new Date(Math.max(Date.now(), offer.expiresAt.getTime()) + input.hours * 60 * 60_000) } });
          targetType = "promotion-offer";
        } else {
          if (!input.awardName && !input.awardType) throw new Error("AWARD_FIELDS_REQUIRED");
          const award = await tx.leagueAward.findUnique({ where: { id: input.targetId } });
          if (!award) throw new Error("TARGET_NOT_FOUND");
          await tx.leagueAward.update({ where: { id: award.id }, data: { ...(input.awardName ? { awardName: input.awardName } : {}), ...(input.awardType ? { awardType: input.awardType } : {}) } });
          targetType = "league-award";
        }
        await tx.adminAuditLog.create({ data: {
          actorTelegramId: actor.telegramId, action: "pyramid-" + input.action, targetType, targetId,
          reason: input.reason ?? null, idempotencyKey: "admin-pyramid:" + input.idempotencyKey,
          metadata: { status: input.status ?? null, hours: input.hours ?? null, awardName: input.awardName ?? null, awardType: input.awardType ?? null },
        } });
        return { ok: true, targetType, targetId };
      }, { isolationLevel: "Serializable" });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "ADMIN_ACTION_FAILED";
      if (message === "TARGET_NOT_FOUND" || message === "PENDING_OFFER_NOT_FOUND") return reply.code(404).send({ error: message });
      if (["STATUS_REQUIRED", "HOURS_REQUIRED", "AWARD_FIELDS_REQUIRED", "LEAGUE_MUST_HAVE_EIGHT_TEAMS", "COMPLETED_LEAGUE_LOCKED", "QUEUED_APPLICATION_NOT_FOUND"].includes(message)) return reply.code(409).send({ error: message });
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "DUPLICATE_OR_IDEMPOTENCY_CONFLICT" });
      throw error;
    }
  });
}
