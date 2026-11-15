import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "./auth/require-telegram-user.js";
import { prisma } from "./db.js";

const MAX_LOGO_BYTES = 512 * 1024;
const logoBody = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  base64: z.string().min(16).max(700_000),
}).strict();

function isValidImage(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

function statsFor(entries: Array<{ finalPosition: number | null; league: { season: number; tier: number; competition: { status: string }; awards: Array<{ clubId: string; placement: number; awardName: string; awardType: string }>; promotionOffers: Array<{ clubId: string; status: string; targetTier: number; finalPosition: number; resolvedAt: Date | null }> } }>, clubId: string) {
  const completed = entries.filter((entry) => entry.finalPosition !== null && entry.league.competition.status === "COMPLETED");
  const promotions = completed.flatMap((entry) => entry.league.promotionOffers.filter((offer) => offer.clubId === clubId && offer.status === "ACCEPTED")
    .map((offer) => ({ season: entry.league.season, tier: entry.league.tier, tierName: tierName(entry.league.tier), position: offer.finalPosition, targetTier: offer.targetTier, movement: "PROMOTION" as const, date: offer.resolvedAt?.toISOString() ?? null })));
  const relegations = completed.filter((entry) => entry.league.tier > 1 && entry.finalPosition! >= 7)
    .map((entry) => ({ season: entry.league.season, tier: entry.league.tier, tierName: tierName(entry.league.tier), position: entry.finalPosition!, targetTier: entry.league.tier - 1, movement: "RELEGATION" as const, date: null }));
  const byTier = new Map<number, { tier: number; tierName: string; appearances: number; championships: number; podiums: number; promotions: number; relegations: number }>();
  for (const entry of completed) {
    const tier = entry.league.tier;
    const row = byTier.get(tier) ?? { tier, tierName: tierName(tier), appearances: 0, championships: 0, podiums: 0, promotions: 0, relegations: 0 };
    row.appearances++;
    if (entry.finalPosition === 1) row.championships++;
    if (entry.finalPosition! <= 3) row.podiums++;
    if (tier > 1 && entry.finalPosition! >= 7) row.relegations++;
    row.promotions += entry.league.promotionOffers.filter((offer) => offer.clubId === clubId && offer.status === "ACCEPTED").length;
    byTier.set(tier, row);
  }
  return {
    stats: {
      seasons: new Set(completed.map((entry) => entry.league.season)).size,
      appearances: completed.length,
      championships: completed.filter((entry) => entry.finalPosition === 1).length,
      podiums: completed.filter((entry) => entry.finalPosition! <= 3).length,
      promotions: promotions.length,
      relegations: relegations.length,
    },
    tiers: [...byTier.values()].sort((a, b) => a.tier - b.tier),
    movements: [...promotions, ...relegations].sort((a, b) => b.season - a.season || a.tier - b.tier),
  };
}
function tierName(tier: number) { return ["", "سطح اول", "سطح دوم", "سطح سوم", "سطح چهارم", "سطح پنجم", "سطح ششم", "سطح هفتم"][tier] ?? "سطح " + tier; }

const completedEntries = {
  where: { finalPosition: { not: null } },
  include: {
    league: {
      include: {
        competition: { select: { status: true } },
        awards: { select: { clubId: true, placement: true, awardName: true, awardType: true } },
        promotionOffers: { select: { clubId: true, status: true, targetTier: true, finalPosition: true, resolvedAt: true } },
      },
    },
  },
  orderBy: { joinedAt: "desc" as const },
};

export function registerPublicClubRoutes(app: FastifyInstance) {
  app.get("/v1/clubs/public", async (request, reply) => {
    const query = z.object({ q: z.string().trim().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_CLUB_QUERY" });
    const clubs = await prisma.club.findMany({
      ...(query.data.q ? { where: { name: { contains: query.data.q } } } : {}),
      take: 200,
      select: {
        id: true, name: true, level: true, reputation: true, logoMime: true,
        pyramidLeagueEntries: completedEntries,
      },
    });
    const ranked = clubs.map((club) => {
      const history = statsFor(club.pyramidLeagueEntries, club.id);
      return { id: club.id, name: club.name, level: club.level, reputation: club.reputation,
        logoUrl: club.logoMime ? "/v1/clubs/" + club.id + "/logo" : null, ...history.stats };
    }).sort((a, b) => b.championships - a.championships || b.podiums - a.podiums || b.promotions - a.promotions || b.level - a.level || a.name.localeCompare(b.name));
    return { clubs: ranked.slice(0, query.data.limit) };
  });

  app.get("/v1/clubs/:clubId/profile", async (request, reply) => {
    const params = z.object({ clubId: z.string().min(1).max(64) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_CLUB_ID" });
    const club = await prisma.club.findUnique({
      where: { id: params.data.clubId },
      include: { pyramidLeagueEntries: completedEntries },
    });
    if (!club) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    const history = statsFor(club.pyramidLeagueEntries, club.id);
    return {
      club: { id: club.id, name: club.name, slug: club.slug, level: club.level, reputation: club.reputation,
        logoUrl: club.logoMime ? "/v1/clubs/" + club.id + "/logo" : null, createdAt: club.createdAt.toISOString() },
      ...history,
      leagues: club.pyramidLeagueEntries.filter((entry) => entry.league.competition.status === "COMPLETED").map((entry) => ({
        id: entry.leagueId, season: entry.league.season, tier: entry.league.tier,
        tierName: tierName(entry.league.tier), groupNumber: entry.league.groupNumber,
        finalPosition: entry.finalPosition, awards: entry.league.awards.filter((award) => award.clubId === club.id),
      })),
    };
  });

  app.get("/v1/clubs/:clubId/logo", async (request, reply) => {
    const params = z.object({ clubId: z.string().min(1).max(64) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_CLUB_ID" });
    const club = await prisma.club.findUnique({ where: { id: params.data.clubId }, select: { logoData: true, logoMime: true } });
    if (!club?.logoData || !club.logoMime) return reply.code(404).send({ error: "CLUB_LOGO_NOT_FOUND" });
    return reply.header("content-type", club.logoMime).header("cache-control", "public, max-age=300").send(Buffer.from(club.logoData, "base64"));
  });

  app.put("/v1/club/logo", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = logoBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_CLUB_LOGO" });
    const bytes = Buffer.from(body.data.base64, "base64");
    if (bytes.length > MAX_LOGO_BYTES || bytes.toString("base64").replace(/=+$/, "") !== body.data.base64.replace(/=+$/, "")
      || !isValidImage(bytes, body.data.mimeType)) return reply.code(400).send({ error: "INVALID_CLUB_LOGO" });
    const club = await prisma.club.update({
      where: { ownerId: user.id },
      data: { logoData: body.data.base64, logoMime: body.data.mimeType },
      select: { id: true, name: true },
    }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") return null;
      throw error;
    });
    if (!club) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    return { updated: true, club, logoUrl: "/v1/clubs/" + club.id + "/logo" };
  });

  app.delete("/v1/club/logo", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const club = await prisma.club.update({
      where: { ownerId: user.id }, data: { logoData: null, logoMime: null }, select: { id: true },
    }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") return null;
      throw error;
    });
    if (!club) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    return { updated: true, removed: true };
  });
}
