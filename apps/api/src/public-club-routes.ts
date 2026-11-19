import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "./auth/require-telegram-user.js";
import { prisma } from "./db.js";
import { consumeAllianceActionRateLimit } from "./groups/alliance-rate-limit.js";
import type { PublicClubLogoRepository } from "./node-supabase-public-club-logo.js";

export interface PublicClubHistoryEntry {
  finalPosition: number | null;
  league: {
    id: string; season: number; tier: number; groupNumber: number;
    competition: { status: string };
    awards: Array<{ clubId: string; placement: number; awardName: string; awardType: string }>;
    promotionOffers: Array<{ clubId: string; status: string; targetTier: number; finalPosition: number; resolvedAt: Date | string | null }>;
  };
}
export interface PublicClubRecord {
  id: string; name: string; level: number; reputation: number; logoMime: string | null;
  pyramidLeagueEntries: PublicClubHistoryEntry[];
}
export interface PublicClubProfile extends PublicClubRecord { slug: string; createdAt: Date | string }
export interface PublicClubComparison {
  clubs: Array<{ id: string; name: string; level: number; reputation: number; logoMime: string | null }>;
  matches: Array<{
    id: string; scheduledAt: Date | string; completedAt: Date | string | null;
    homeClubId: string; awayClubId: string; homeScore: number | null; awayScore: number | null; type: string;
    homeClub: { name: string }; awayClub: { name: string };
    competition: { name: string; season: number } | null;
  }>;
}
export interface PublicClubReadRepository {
  list(query: string | null): Promise<PublicClubRecord[]>;
  profile(clubId: string): Promise<PublicClubProfile | null>;
  compare(first: string, second: string): Promise<PublicClubComparison | null>;
}

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

function statsFor(entries: Array<{ finalPosition: number | null; league: { season: number; tier: number; competition: { status: string }; awards: Array<{ clubId: string; placement: number; awardName: string; awardType: string }>; promotionOffers: Array<{ clubId: string; status: string; targetTier: number; finalPosition: number; resolvedAt: Date | string | null }> } }>, clubId: string) {
  const completed = entries.filter((entry) => entry.finalPosition !== null && entry.league.competition.status === "COMPLETED");
  const promotions = completed.flatMap((entry) => entry.league.promotionOffers.filter((offer) => offer.clubId === clubId && offer.status === "ACCEPTED")
    .map((offer) => ({ season: entry.league.season, tier: entry.league.tier, tierName: tierName(entry.league.tier), position: offer.finalPosition, targetTier: offer.targetTier, movement: "PROMOTION" as const, date: offer.resolvedAt ? new Date(offer.resolvedAt instanceof Date ? offer.resolvedAt.getTime() : offer.resolvedAt).toISOString() : null })));
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
function toIso(value: Date | string) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
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

export function registerPublicClubRoutes(app: FastifyInstance, logoRepository?: PublicClubLogoRepository, readRepository?: PublicClubReadRepository) {
  app.get("/v1/clubs/public", async (request, reply) => {
    const query = z.object({ q: z.string().trim().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_CLUB_QUERY" });
    const clubs = readRepository ? await readRepository.list(query.data.q ?? null) : await prisma.club.findMany({
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
    const club = readRepository ? await readRepository.profile(params.data.clubId) : await prisma.club.findUnique({
      where: { id: params.data.clubId },
      include: { pyramidLeagueEntries: completedEntries },
    });
    if (!club) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    const history = statsFor(club.pyramidLeagueEntries, club.id);
    return {
      club: { id: club.id, name: club.name, slug: club.slug, level: club.level, reputation: club.reputation,
        logoUrl: club.logoMime ? "/v1/clubs/" + club.id + "/logo" : null, createdAt: toIso(club.createdAt) },
      ...history,
      leagues: club.pyramidLeagueEntries.filter((entry) => entry.league.competition.status === "COMPLETED").map((entry) => ({
        id: "leagueId" in entry ? entry.leagueId : entry.league.id, season: entry.league.season, tier: entry.league.tier,
        tierName: tierName(entry.league.tier), groupNumber: entry.league.groupNumber,
        finalPosition: entry.finalPosition, awards: entry.league.awards.filter((award) => award.clubId === club.id),
      })),
    };
  });


  app.get("/v1/clubs/compare", async (request, reply) => {
    const query = z.object({
      first: z.string().min(1).max(64),
      second: z.string().min(1).max(64),
    }).safeParse(request.query);
    if (!query.success || query.data.first === query.data.second) {
      return reply.code(400).send({ error: "INVALID_CLUB_COMPARISON" });
    }
    const comparison = readRepository ? await readRepository.compare(query.data.first, query.data.second) : null;
    if (readRepository && !comparison) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    const [first, second] = comparison ? comparison.clubs : await Promise.all([
      prisma.club.findUnique({ where: { id: query.data.first }, select: { id: true, name: true, level: true, reputation: true, logoMime: true } }),
      prisma.club.findUnique({ where: { id: query.data.second }, select: { id: true, name: true, level: true, reputation: true, logoMime: true } }),
    ]);
    if (!first || !second) return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    const matches = comparison ? comparison.matches : await prisma.footballMatch.findMany({
      where: {
        status: "COMPLETED",
        OR: [
          { homeClubId: first.id, awayClubId: second.id },
          { homeClubId: second.id, awayClubId: first.id },
        ],
      },
      orderBy: [{ completedAt: "desc" }, { scheduledAt: "desc" }],
      select: {
        id: true, scheduledAt: true, completedAt: true, homeClubId: true, awayClubId: true,
        homeScore: true, awayScore: true, type: true,
        homeClub: { select: { name: true } }, awayClub: { select: { name: true } },
        competition: { select: { name: true, season: true } },
      },
    });
    const summarize = (clubId: string) => {
      const summary = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, homePlayed: 0, awayPlayed: 0, biggestWin: null as null | { margin: number; score: string; opponent: string } };
      for (const match of matches) {
        const home = match.homeClubId === clubId;
        const goalsFor = (home ? match.homeScore : match.awayScore) ?? 0;
        const goalsAgainst = (home ? match.awayScore : match.homeScore) ?? 0;
        summary.played++;
        summary.goalsFor += goalsFor;
        summary.goalsAgainst += goalsAgainst;
        if (home) summary.homePlayed++; else summary.awayPlayed++;
        if (goalsFor > goalsAgainst) summary.won++;
        else if (goalsFor === goalsAgainst) summary.drawn++;
        else summary.lost++;
        const margin = goalsFor - goalsAgainst;
        if (margin > 0 && (!summary.biggestWin || margin > summary.biggestWin.margin)) {
          summary.biggestWin = { margin, score: goalsFor + "-" + goalsAgainst, opponent: home ? match.awayClub.name : match.homeClub.name };
        }
      }
      return { ...summary, goalDifference: summary.goalsFor - summary.goalsAgainst };
    };
    return {
      clubs: [first, second].map((club) => ({
        id: club.id, name: club.name, level: club.level, reputation: club.reputation,
        logoUrl: club.logoMime ? "/v1/clubs/" + club.id + "/logo" : null,
        record: summarize(club.id),
      })),
      headToHead: {
        totalMatches: matches.length,
        recentMatches: matches.slice(0, 20).map((match) => ({
          id: match.id, date: toIso(match.completedAt ?? match.scheduledAt),
          type: match.type, homeClub: match.homeClub.name, awayClub: match.awayClub.name,
          homeScore: match.homeScore, awayScore: match.awayScore,
          competition: match.competition?.name ?? null, season: match.competition?.season ?? null,
        })),
      },
    };
  });

  app.get("/v1/clubs/:clubId/logo", async (request, reply) => {
    const params = z.object({ clubId: z.string().min(1).max(64) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_CLUB_ID" });
    const club = logoRepository
      ? await logoRepository.getLogo(params.data.clubId)
      : await prisma.club.findUnique({ where: { id: params.data.clubId }, select: { logoData: true, logoMime: true } });
    if (!club?.logoData || !club.logoMime) return reply.code(404).send({ error: "CLUB_LOGO_NOT_FOUND" });
    return reply.header("content-type", club.logoMime).header("cache-control", "public, max-age=300").send(Buffer.from(club.logoData, "base64"));
  });

  app.put("/v1/club/logo", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    if (!await consumeAllianceActionRateLimit({ telegramUserId: user.telegramId, telegramGroupId: "global", action: "club-logo-upload", limit: 5 })) return reply.code(429).send({ error: "CLUB_LOGO_RATE_LIMITED", retryAfterSeconds: 60 });
    const body = logoBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_CLUB_LOGO" });
    const bytes = Buffer.from(body.data.base64, "base64");
    if (bytes.length > MAX_LOGO_BYTES || bytes.toString("base64").replace(/=+$/, "") !== body.data.base64.replace(/=+$/, "")
      || !isValidImage(bytes, body.data.mimeType)) return reply.code(400).send({ error: "INVALID_CLUB_LOGO" });
    const result = logoRepository
      ? await logoRepository.manageLogo(user.id, "upload", body.data.base64, body.data.mimeType)
      : await prisma.$transaction(async (tx) => {
      const current = await tx.club.findUnique({
        where: { ownerId: user.id },
        select: {
          id: true,
          competitionEntries: {
            where: { competition: { status: "ACTIVE" } }, take: 1,
            select: { competition: { select: { id: true, name: true } } },
          },
          pyramidLeagueEntries: {
            where: { league: { competition: { status: "ACTIVE" } } }, take: 1,
            select: { league: { select: { competition: { select: { id: true, name: true } } } } },
          },
        },
      });
      if (!current) return { kind: "NOT_FOUND" as const };
      const activeCompetition = current.competitionEntries[0]?.competition
        ?? current.pyramidLeagueEntries[0]?.league.competition
        ?? null;
      if (activeCompetition) return { kind: "LOCKED" as const, activeCompetition };
      const club = await tx.club.update({
        where: { id: current.id },
        data: { logoData: body.data.base64, logoMime: body.data.mimeType },
        select: { id: true, name: true },
      });
      return { kind: "UPDATED" as const, club };
    }, { isolationLevel: "Serializable" });
    if (result.kind === "NOT_FOUND") return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    if (result.kind === "LOCKED") return reply.code(409).send({ error: "CLUB_EDIT_LOCKED_ACTIVE_LEAGUE", activeCompetition: result.activeCompetition });
    if (!result.club) return reply.code(500).send({ error: "CLUB_LOGO_UPDATE_FAILED" });
    return { updated: true, club: result.club, logoUrl: "/v1/clubs/" + result.club.id + "/logo" };
  });

  app.delete("/v1/club/logo", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    if (!await consumeAllianceActionRateLimit({ telegramUserId: user.telegramId, telegramGroupId: "global", action: "club-logo-delete", limit: 5 })) return reply.code(429).send({ error: "CLUB_LOGO_RATE_LIMITED", retryAfterSeconds: 60 });
    const result = logoRepository
      ? await logoRepository.manageLogo(user.id, "delete")
      : await prisma.$transaction(async (tx) => {
      const current = await tx.club.findUnique({
        where: { ownerId: user.id },
        select: {
          id: true,
          competitionEntries: {
            where: { competition: { status: "ACTIVE" } }, take: 1,
            select: { competition: { select: { id: true, name: true } } },
          },
          pyramidLeagueEntries: {
            where: { league: { competition: { status: "ACTIVE" } } }, take: 1,
            select: { league: { select: { competition: { select: { id: true, name: true } } } } },
          },
        },
      });
      if (!current) return { kind: "NOT_FOUND" as const };
      const activeCompetition = current.competitionEntries[0]?.competition
        ?? current.pyramidLeagueEntries[0]?.league.competition
        ?? null;
      if (activeCompetition) return { kind: "LOCKED" as const, activeCompetition };
      await tx.club.update({ where: { id: current.id }, data: { logoData: null, logoMime: null }, select: { id: true } });
      return { kind: "UPDATED" as const };
    }, { isolationLevel: "Serializable" });
    if (result.kind === "NOT_FOUND") return reply.code(404).send({ error: "CLUB_NOT_FOUND" });
    if (result.kind === "LOCKED") return reply.code(409).send({ error: "CLUB_EDIT_LOCKED_ACTIVE_LEAGUE", activeCompetition: result.activeCompetition });
    return { updated: true, removed: true };
  });
}
