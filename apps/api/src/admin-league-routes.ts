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

function roleFor(telegramId: string) {
  const superAdmins = (process.env.GAME_ADMIN_TELEGRAM_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (superAdmins.includes(telegramId)) return "superadmin";
  try {
    const roles = JSON.parse(process.env.GAME_ADMIN_ROLE_MAP ?? "{}") as Record<string, string>;
    return roles[telegramId] && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, roles[telegramId]!) ? roles[telegramId]! : null;
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
  const role = roleFor(user.telegramId);
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
