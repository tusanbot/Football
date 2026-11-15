import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { calculateLeaguePlayerValue, leagueTier, rankLeagueTeams } from "@football/domain";
import { prisma } from "../db.js";

const DAY_MS = 86_400_000;

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code !== "P2034" || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 15));
    }
  }
  throw new Error("SERIALIZABLE_RETRY_EXHAUSTED");
}

const LEAGUE_RULES = {
  maxSubstitutions: 5, maxInPlayWindows: 3, injuriesEnabled: true, injuryDurationDays: 5,
  redCardSuspensionMatches: 1, yellowCardsToSuspend: 3, yellowCardSuspensionMatches: 1, penaltiesOnDraw: false,
};

export class PyramidLeagueError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "PyramidLeagueError"; }
}

async function ownedClub(userId: string) {
  const club = await prisma.club.findUnique({
    where: { ownerId: userId },
    select: { id: true, name: true, ownerId: true, players: { where: { status: "ACTIVE" }, select: { id: true, position: true } } },
  });
  if (!club) throw new PyramidLeagueError("CLUB_NOT_FOUND");
  if (club.players.length < 11 || !club.players.some((player) => player.position === "GK")) {
    throw new PyramidLeagueError("ALL_TEAMS_NEED_VALID_LINEUPS");
  }
  return club;
}

async function createLeagueForEight(tx: Prisma.TransactionClient, tier: number, season: number, applications: Array<{ id: string; clubId: string; userId: string }>, now: Date) {
  if (applications.length !== 8) throw new PyramidLeagueError("PYRAMID_LEAGUE_REQUIRES_EIGHT_TEAMS");
  const groupNumber = await tx.pyramidLeague.count({ where: { tier, season } }) + 1;
  const level = leagueTier(tier);
  const idempotencyKey = `pyramid:${tier}:${season}:${groupNumber}`;
  const competition = await tx.competition.create({
    data: {
      idempotencyKey, name: `${level.name} · گروه ${groupNumber}`, season,
      format: "LEAGUE", status: "ACTIVE", maxTeams: 8, createdByClubId: (await tx.club.findUniqueOrThrow({ where: { id: applications[0]!.clubId }, select: { id: true } })).id,
      rules: LEAGUE_RULES, startsAt: new Date(now.getTime() + DAY_MS),
      entries: { create: applications.map((application) => ({ clubId: application.clubId })) },
    },
  });
  const league = await tx.pyramidLeague.create({
    data: {
      competitionId: competition.id, tier, season, groupNumber,
      entries: { create: applications.map((application) => ({ clubId: application.clubId })) },
    },
  });
  await tx.pyramidLeagueApplication.updateMany({
    where: { id: { in: applications.map((application) => application.id) }, status: "QUEUED" },
    data: { status: "ASSIGNED", assignedLeagueId: league.id },
  });
  const clubs = applications.map((application) => application.clubId);
  const slots: Array<string | null> = [...clubs];
  const rounds = slots.length - 1;
  const fixtures: Array<{ idempotencyKey: string; type: "LEAGUE"; competitionId: string; round: number; homeClubId: string; awayClubId: string; scheduledAt: Date; seed: string; rulesSnapshot: Prisma.InputJsonValue }> = [];
  for (let round = 0; round < rounds; round++) {
    for (let index = 0; index < slots.length / 2; index++) {
      const first = slots[index]!;
      const second = slots[slots.length - 1 - index]!;
      const swap = (round + index) % 2 === 1;
      const homeClubId = swap ? second : first;
      const awayClubId = swap ? first : second;
      const key = `${idempotencyKey}:r${round + 1}:${homeClubId}:${awayClubId}`;
      fixtures.push({
        idempotencyKey: key, type: "LEAGUE", competitionId: competition.id, round: round + 1,
        homeClubId, awayClubId, scheduledAt: new Date(now.getTime() + (round + 1) * 3 * DAY_MS),
        seed: key, rulesSnapshot: LEAGUE_RULES as unknown as Prisma.InputJsonValue,
      });
    }
    const fixed = slots[0]!;
    const rotating = slots.slice(1);
    rotating.unshift(rotating.pop()!);
    slots.splice(0, slots.length, fixed, ...rotating);
  }
  await tx.footballMatch.createMany({ data: fixtures });
  return { leagueId: league.id, competitionId: competition.id, tier, tierName: level.name, season, groupNumber, teams: clubs.length, fixturesCreated: fixtures.length };
}

async function assignQueueIfReady(tx: Prisma.TransactionClient, tier: number, season: number, now: Date) {
  const queue = await tx.pyramidLeagueApplication.findMany({
    where: { tier, season, status: "QUEUED" },
    orderBy: [{ appliedAt: "asc" }, { id: "asc" }], take: 8,
    select: { id: true, clubId: true, userId: true },
  });
  if (queue.length < 8) return null;
  return createLeagueForEight(tx, tier, season, queue, now);
}

export async function applyForPyramidLeague(userId: string, tier: number, now = new Date()) {
  const club = await ownedClub(userId);
  leagueTier(tier);
  if (tier !== 1) throw new PyramidLeagueError("DIRECT_TIER_ENTRY_NOT_ALLOWED");
  const season = now.getUTCFullYear() + 1;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.pyramidLeagueApplication.findUnique({ where: { clubId_tier_season: { clubId: club.id, tier, season } } });
    if (existing && existing.status !== "WITHDRAWN") {
      return { applied: true, replayed: true, status: existing.status, leagueId: existing.assignedLeagueId, waitingTeams: await tx.pyramidLeagueApplication.count({ where: { tier, season, status: "QUEUED" } }) };
    }
    if (existing) throw new PyramidLeagueError("APPLICATION_ALREADY_WITHDRAWN");
    const current = await tx.pyramidLeagueEntry.findFirst({ where: { clubId: club.id, league: { competition: { status: "ACTIVE" } } } });
    if (current) throw new PyramidLeagueError("CLUB_ALREADY_IN_ACTIVE_PYRAMID_LEAGUE");
    const application = await tx.pyramidLeagueApplication.create({ data: { userId, clubId: club.id, tier, season } });
    const created = await assignQueueIfReady(tx, tier, season, now);
    if (!created) {
      const waitingTeams = await tx.pyramidLeagueApplication.count({ where: { tier, season, status: "QUEUED" } });
      return { applied: true, replayed: false, status: "QUEUED", leagueId: null, waitingTeams, requiredTeams: 8 };
    }
    return { applied: true, replayed: false, status: "ASSIGNED", ...created, waitingTeams: await tx.pyramidLeagueApplication.count({ where: { tier, season, status: "QUEUED" } }) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function listPyramidLeagues(userId: string) {
  const club = await ownedClub(userId);
  const season = new Date().getUTCFullYear() + 1;
  const [leagues, applications, currentEntry, promotionOffers, historyLeagues] = await Promise.all([
    prisma.pyramidLeague.findMany({
      where: { season }, include: {
        competition: { select: { id: true, name: true, status: true, startsAt: true, completedAt: true } },
        entries: { select: { clubId: true, club: { select: { name: true } } } },
      }, orderBy: [{ tier: "asc" }, { groupNumber: "asc" }],
    }),
    prisma.pyramidLeagueApplication.findMany({
      where: { clubId: club.id, season }, orderBy: { appliedAt: "desc" }, take: 20,
    }),
    prisma.pyramidLeagueEntry.findFirst({ where: { clubId: club.id, league: { season } }, include: { league: true } }),
    prisma.leaguePromotionOffer.findMany({ where: { clubId: club.id, status: "PENDING" }, include: { league: { select: { tier: true, season: true } } }, orderBy: { offeredAt: "desc" } }),
    prisma.pyramidLeague.findMany({ where: { season: { lt: season } }, include: { competition: { select: { name: true, status: true } }, entries: { select: { clubId: true } } }, orderBy: [{ season: "desc" }, { tier: "asc" }, { groupNumber: "asc" }], take: 100 }),
  ]);
  const queueCounts = await prisma.pyramidLeagueApplication.groupBy({
    by: ["tier"], where: { season, status: "QUEUED" }, _count: { _all: true },
  });
  return {
    season, tiers: Array.from({ length: 7 }, (_, index) => {
      const tier = index + 1;
      const level = leagueTier(tier);
      return {
        tier, key: level.key, name: level.name,
        waitingTeams: queueCounts.find((row) => row.tier === tier)?._count._all ?? 0,
        leagues: leagues.filter((league) => league.tier === tier).map((league) => ({
          id: league.id, competitionId: league.competition.id, name: league.competition.name,
          status: league.competition.status, startsAt: league.competition.startsAt?.toISOString() ?? null,
          teams: league.entries.length, clubs: league.entries.map((entry) => entry.club.name),
          isMyLeague: league.entries.some((entry) => entry.clubId === club.id),
        })),
        myApplication: applications.find((application) => application.tier === tier)?.status ?? null,
      };
    }),
    currentLeagueId: currentEntry?.leagueId ?? null,
    promotionOffers: promotionOffers.map((offer) => ({ id: offer.id, fromTier: offer.league.tier, targetTier: offer.targetTier, season: offer.league.season, finalPosition: offer.finalPosition })),
    history: historyLeagues.map((league) => ({ id: league.id, tier: league.tier, tierName: leagueTier(league.tier).name, season: league.season, groupNumber: league.groupNumber, name: league.competition.name, status: league.competition.status, teams: league.entries.length })),
  };
}

export async function getPyramidLeagueClubHistory(userId: string) {
  const club = await ownedClub(userId);
  const entries = await prisma.pyramidLeagueEntry.findMany({
    where: { clubId: club.id, league: { competition: { status: "COMPLETED" } } },
    orderBy: { joinedAt: "desc" },
    take: 100,
    include: {
      league: {
        include: {
          competition: { select: { name: true, completedAt: true } },
          awards: { where: { clubId: club.id }, select: { placement: true, awardName: true, awardType: true } },
          promotionOffers: { where: { clubId: club.id }, select: { targetTier: true, finalPosition: true, status: true, offeredAt: true, resolvedAt: true } },
        },
      },
    },
  });
  const completed = entries.filter((entry) => entry.finalPosition !== null);
  const acceptedPromotions = entries.flatMap((entry) => entry.league.promotionOffers
    .filter((offer) => offer.status === "ACCEPTED")
    .map((offer) => ({ season: entry.league.season, tier: entry.league.tier, tierName: leagueTier(entry.league.tier).name,
      position: offer.finalPosition, targetTier: offer.targetTier, status: offer.status, date: offer.resolvedAt?.toISOString() ?? offer.offeredAt.toISOString() })));
  const relegations = completed.filter((entry) => entry.league.tier > 1 && entry.finalPosition! >= 7)
    .map((entry) => ({ season: entry.league.season, tier: entry.league.tier, tierName: leagueTier(entry.league.tier).name,
      position: entry.finalPosition!, targetTier: entry.league.tier - 1, status: "RELEGATED" }));
  const byTier = new Map<number, { tier: number; tierName: string; appearances: number; championships: number; podiums: number; promotions: number; relegations: number }>();
  for (const entry of completed) {
    const tier = entry.league.tier;
    const row = byTier.get(tier) ?? { tier, tierName: leagueTier(tier).name, appearances: 0, championships: 0, podiums: 0, promotions: 0, relegations: 0 };
    row.appearances += 1;
    if (entry.finalPosition === 1) row.championships += 1;
    if (entry.finalPosition! <= 3) row.podiums += 1;
    if (tier > 1 && entry.finalPosition! >= 7) row.relegations += 1;
    row.promotions += entry.league.promotionOffers.filter((offer) => offer.status === "ACCEPTED").length;
    byTier.set(tier, row);
  }
  return {
    club: { id: club.id, name: club.name },
    stats: {
      seasons: new Set(completed.map((entry) => entry.league.season)).size,
      appearances: completed.length,
      championships: completed.filter((entry) => entry.finalPosition === 1).length,
      podiums: completed.filter((entry) => entry.finalPosition! <= 3).length,
      promotions: acceptedPromotions.length,
      relegations: relegations.length,
    },
    tiers: [...byTier.values()].sort((a, b) => a.tier - b.tier),
    movements: [
      ...acceptedPromotions.map((item) => ({ ...item, movement: "PROMOTION" as const })),
      ...relegations.map((item) => ({ ...item, movement: "RELEGATION" as const })),
    ].sort((a, b) => b.season - a.season || a.tier - b.tier || a.position - b.position),
    leagues: entries.map((entry) => ({
      id: entry.leagueId, name: entry.league.competition.name, season: entry.league.season,
      tier: entry.league.tier, tierName: leagueTier(entry.league.tier).name, groupNumber: entry.league.groupNumber,
      finalPosition: entry.finalPosition, completedAt: entry.league.competition.completedAt?.toISOString() ?? null,
      awards: entry.league.awards,
      promotionOffers: entry.league.promotionOffers.map((offer) => ({
        targetTier: offer.targetTier, finalPosition: offer.finalPosition, status: offer.status,
        offeredAt: offer.offeredAt.toISOString(), resolvedAt: offer.resolvedAt?.toISOString() ?? null,
      })),
    })),
  };
}

export async function getPyramidLeagueDetails(userId: string, leagueId: string) {
  await ownedClub(userId);
  const league = await prisma.pyramidLeague.findUnique({
    where: { id: leagueId },
    include: {
      competition: { include: {
        entries: { include: { club: { select: { id: true, name: true } } } },
        matches: { include: { homeClub: { select: { id: true, name: true } }, awayClub: { select: { id: true, name: true } } }, orderBy: [{ round: "asc" }, { scheduledAt: "asc" }] },
      } },
      entries: { select: { clubId: true } },
      awards: { include: { club: { select: { id: true, name: true } } }, orderBy: { placement: "asc" } },
    },
  });
  if (!league) throw new PyramidLeagueError("PYRAMID_LEAGUE_NOT_FOUND");
  const standings = rankLeagueTeams(league.competition.entries.map((entry) => ({
    clubId: entry.clubId, clubName: entry.club.name, played: entry.played, won: entry.won, drawn: entry.drawn, lost: entry.lost,
    goalsFor: entry.goalsFor, goalsAgainst: entry.goalsAgainst, goalDifference: entry.goalsFor - entry.goalsAgainst,
    points: entry.points, wins: entry.won,
  })));
  const [scorers, assists] = await Promise.all([
    prisma.playerMatchPerformance.groupBy({ by: ["playerId", "clubId"], where: { match: { competitionId: league.competitionId } }, _sum: { goals: true }, orderBy: { _sum: { goals: "desc" } }, take: 20 }),
    prisma.playerMatchPerformance.groupBy({ by: ["playerId", "clubId"], where: { match: { competitionId: league.competitionId } }, _sum: { assists: true }, orderBy: { _sum: { assists: "desc" } }, take: 20 }),
  ]);
  const playerIds = [...new Set([...scorers, ...assists].map((row) => row.playerId))];
  const players = await prisma.player.findMany({ where: { id: { in: playerIds } }, select: { id: true, firstName: true, lastName: true } });
  const names = new Map(players.map((player) => [player.id, player.firstName + " " + player.lastName]));
  const clubNames = new Map(league.competition.entries.map((entry) => [entry.clubId, entry.club.name]));
  return {
    league: { id: league.id, tier: league.tier, tierName: leagueTier(league.tier).name, season: league.season, groupNumber: league.groupNumber, name: league.competition.name, status: league.competition.status, startsAt: league.competition.startsAt?.toISOString() ?? null },
    standings: standings.map((row, index) => ({ ...row, position: index + 1 })),
    topScorers: scorers.map((row) => ({ playerId: row.playerId, playerName: names.get(row.playerId) ?? "Unknown", clubId: row.clubId, clubName: clubNames.get(row.clubId) ?? "Club", goals: row._sum.goals ?? 0 })),
    topAssists: assists.map((row) => ({ playerId: row.playerId, playerName: names.get(row.playerId) ?? "Unknown", clubId: row.clubId, clubName: clubNames.get(row.clubId) ?? "Club", assists: row._sum.assists ?? 0 })),
    matches: league.competition.matches.map((match) => ({ id: match.id, round: match.round, scheduledAt: match.scheduledAt.toISOString(), status: match.status, homeClub: match.homeClub, awayClub: match.awayClub, homeScore: match.homeScore, awayScore: match.awayScore })),
    awards: league.awards.map((award) => ({ placement: award.placement, awardName: award.awardName, awardType: award.awardType, clubName: award.club.name })),
  };
}

async function addNotice(tx: Prisma.TransactionClient, userId: string, kind: string, title: string, body: string, referenceId: string) {
  await tx.leagueNotice.create({ data: { userId, kind, title, body, referenceId } });
}

async function adjustPlayerValues(tx: Prisma.TransactionClient, clubId: string, fromTier: number, toTier: number) {
  const players = await tx.player.findMany({ where: { clubId }, select: { id: true, marketValue: true } });
  for (const player of players) {
    await tx.player.update({ where: { id: player.id }, data: { marketValue: calculateLeaguePlayerValue(player.marketValue, fromTier, toTier) } });
    const listings = await tx.playerMarketListing.findMany({ where: { playerId: player.id, status: "OPEN" }, select: { id: true, askingPrice: true } });
    for (const listing of listings) {
      await tx.playerMarketListing.update({ where: { id: listing.id }, data: { askingPrice: calculateLeaguePlayerValue(listing.askingPrice, fromTier, toTier) } });
    }
  }
}

export async function respondToPromotion(userId: string, offerId: string, accept: boolean, now = new Date()) {
  const club = await ownedClub(userId);
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const offer = await tx.leaguePromotionOffer.findUnique({
      where: { id: offerId },
      include: { league: { include: { competition: { include: { entries: { include: { club: { select: { id: true, ownerId: true } } } } } } } } },
    });
    if (!offer) throw new PyramidLeagueError("PROMOTION_OFFER_NOT_FOUND");
    if (offer.clubId !== club.id) throw new PyramidLeagueError("NOT_PROMOTION_OFFER_OWNER");
    if (offer.status !== "PENDING") {
      const sameDecision = (accept && offer.status === "ACCEPTED") || (!accept && offer.status === "DECLINED");
      if (!sameDecision) throw new PyramidLeagueError("PROMOTION_OFFER_ALREADY_RESOLVED");
      if (accept) {
        return { offer, accepted: true, targetTier: offer.targetTier, season: offer.league.season + 1, createdLeague: null, replayed: true };
      }
      const replacement = await tx.leaguePromotionOffer.findFirst({
        where: { leagueId: offer.leagueId, finalPosition: { gt: 2 }, status: { in: ["PENDING", "ACCEPTED"] } },
        orderBy: { offeredAt: "asc" }, select: { id: true, clubId: true },
      });
      return { offer, accepted: false, replayed: true,
        ...(replacement ? { replacementOfferId: replacement.id, replacementClubId: replacement.clubId } : { replacementClubId: null }) };
    }
    if (offer.expiresAt <= now) throw new PyramidLeagueError("PROMOTION_OFFER_EXPIRED");
    const updated = await tx.leaguePromotionOffer.update({ where: { id: offerId }, data: { status: accept ? "ACCEPTED" : "DECLINED", resolvedAt: now } });
    const sourceTier = offer.league.tier;
    const season = offer.league.season + 1;
    if (accept) {
      await tx.pyramidLeagueApplication.upsert({
        where: { clubId_tier_season: { clubId: club.id, tier: offer.targetTier, season } },
        create: { userId, clubId: club.id, tier: offer.targetTier, season },
        update: { status: "QUEUED", appliedAt: now },
      });
      await adjustPlayerValues(tx, club.id, sourceTier, offer.targetTier);
      await addNotice(tx, userId, "PROMOTION_ACCEPTED", "صعود تأیید شد", `تیم شما به ${leagueTier(offer.targetTier).name} صعود کرد و در صف تشکیل لیگ فصل ${season} قرار گرفت.`, offer.id);
      const createdLeague = await assignQueueIfReady(tx, offer.targetTier, season, now);
      return { offer: updated, accepted: true, targetTier: offer.targetTier, season, createdLeague, replayed: false };
    }
    await addNotice(tx, userId, "PROMOTION_DECLINED", "انصراف از صعود ثبت شد", "انصراف شما ثبت شد؛ تیم بعدی جدول برای دریافت سهمیه صعود بررسی می‌شود.", offer.id);
    const existingOffers = await tx.leaguePromotionOffer.findMany({ where: { leagueId: offer.leagueId }, select: { finalPosition: true, status: true, clubId: true } });
    const filledSlots = existingOffers.filter((item) => item.status === "PENDING" || item.status === "ACCEPTED").length;
    if (filledSlots < 2) {
      const rankedForReplacement = rankLeagueTeams(offer.league.competition.entries.map((entry) => ({
        clubId: entry.clubId, points: entry.points, goalDifference: entry.goalsFor - entry.goalsAgainst,
        goalsFor: entry.goalsFor, wins: entry.won,
      })));
      const next = rankedForReplacement.find((row) => !existingOffers.some((item) => item.clubId === row.clubId));
      if (next) {
        const replacement = offer.league.competition.entries.find((entry) => entry.clubId === next.clubId);
        if (replacement) {
          const nextUser = await tx.user.findUnique({ where: { id: replacement.club.ownerId }, select: { id: true } });
          if (nextUser) {
            const nextPosition = rankedForReplacement.findIndex((row) => row.clubId === next.clubId) + 1;
            const nextOffer = await tx.leaguePromotionOffer.create({ data: { leagueId: offer.leagueId, clubId: next.clubId, targetTier: offer.targetTier, finalPosition: nextPosition, expiresAt: new Date(now.getTime() + 24 * 60 * 60_000) } });
            await addNotice(tx, nextUser.id, "PROMOTION_REPLACEMENT", "فرصت صعود به شما رسید", "به‌دلیل انصراف تیم بالاتر، سهمیه صعود به تیم شما پیشنهاد شده است. برای پذیرش یا رد، وارد بخش لیگ‌ها شوید.", nextOffer.id);
            await addNotice(tx, userId, "PROMOTION_REPLACEMENT_NOTIFIED", "تیم جایگزین مطلع شد", "تیم بعدی جدول از پیشنهاد صعود مطلع شد.", nextOffer.id);
            return { offer: updated, accepted: false, replacementOfferId: nextOffer.id, replacementClubId: next.clubId, replayed: false };
          }
        }
      }
    }
    return { offer: updated, accepted: false, replacementClubId: null, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function processPyramidLeagueCompletion(competitionId: string, now = new Date()) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const league = await tx.pyramidLeague.findUnique({
      where: { competitionId },
      include: { competition: { include: { entries: { include: { club: { select: { id: true, ownerId: true, name: true } } } } } } },
    });
    if (!league || league.promotionProcessedAt || league.competition.status !== "COMPLETED") return { processed: false };
    const ranked = rankLeagueTeams(league.competition.entries.map((entry) => ({
      clubId: entry.clubId, clubName: entry.club.name, points: entry.points,
      goalDifference: entry.goalsFor - entry.goalsAgainst, goalsFor: entry.goalsFor, wins: entry.won,
    })));
    if (ranked.length !== 8) throw new PyramidLeagueError("PYRAMID_LEAGUE_REQUIRES_EIGHT_TEAMS");
    const claimed = await tx.pyramidLeague.updateMany({ where: { id: league.id, promotionProcessedAt: null }, data: { promotionProcessedAt: now } });
    if (claimed.count !== 1) return { processed: false, replayed: true };
    for (let index = 0; index < ranked.length; index++) {
      const row = ranked[index]!;
      await tx.pyramidLeagueEntry.update({ where: { leagueId_clubId: { leagueId: league.id, clubId: row.clubId } }, data: { finalPosition: index + 1 } });
    }
    const tierName = leagueTier(league.tier).name;
    const placements = [
      { clubId: ranked[0]!.clubId, placement: 1, awardName: `جام قهرمانی ${tierName}`, awardType: "TROPHY_GOLD" },
      { clubId: ranked[1]!.clubId, placement: 2, awardName: `مدال نقره ${tierName}`, awardType: "MEDAL_SILVER" },
      { clubId: ranked[2]!.clubId, placement: 3, awardName: `مدال برنز ${tierName}`, awardType: "MEDAL_BRONZE" },
    ];
    await tx.leagueAward.createMany({ data: placements.map((award) => ({ ...award, leagueId: league.id, season: league.season, tier: league.tier })) });
    if (league.tier < 7) {
      for (const row of ranked.slice(0, 2)) {
        const entry = league.competition.entries.find((item) => item.clubId === row.clubId)!;
        const offer = await tx.leaguePromotionOffer.create({ data: { leagueId: league.id, clubId: row.clubId, targetTier: league.tier + 1, finalPosition: ranked.findIndex((item) => item.clubId === row.clubId) + 1, expiresAt: new Date(now.getTime() + 24 * 60 * 60_000) } });
        await addNotice(tx, entry.club.ownerId, "PROMOTION_OFFER", "پیشنهاد صعود", `تیم شما در ${tierName} جزو دو تیم برتر شده است. برای صعود به ${leagueTier(league.tier + 1).name} باید پیشنهاد را تأیید کنید.`, offer.id);
      }
    }
    if (league.tier > 1) {
      for (const row of ranked.slice(6, 8)) {
        const entry = league.competition.entries.find((item) => item.clubId === row.clubId)!;
        await tx.pyramidLeagueApplication.upsert({
          where: { clubId_tier_season: { clubId: row.clubId, tier: league.tier - 1, season: league.season + 1 } },
          create: { userId: entry.club.ownerId, clubId: row.clubId, tier: league.tier - 1, season: league.season + 1 },
          update: { status: "QUEUED", appliedAt: now },
        });
        await adjustPlayerValues(tx, row.clubId, league.tier, league.tier - 1);
        await addNotice(tx, entry.club.ownerId, "RELEGATION", "سقوط به سطح پایین‌تر", `تیم شما در فصل بعد در ${leagueTier(league.tier - 1).name} حضور خواهد داشت.`, league.id);
      }
      await assignQueueIfReady(tx, league.tier - 1, league.season + 1, now);
    }
    return { processed: true, leagueId: league.id, champion: ranked[0]!.clubId, runnerUp: ranked[1]!.clubId, thirdPlace: ranked[2]!.clubId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function listLeagueNotices(userId: string) {
  const notices = await prisma.leagueNotice.findMany({ where: { userId, readAt: null }, select: { id: true, kind: true, title: true, body: true, referenceId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 });
  return { notices };
}

export async function createFriendlyChallenge(
  userId: string, goldCost: bigint, now: Date, groupTelegramId: string | undefined, idempotencyKey: string,
) {
  if (!/^[A-Za-z0-9:_-]{12,128}$/.test(idempotencyKey)) throw new PyramidLeagueError("INVALID_IDEMPOTENCY_KEY");
  if (goldCost <= 0n) throw new PyramidLeagueError("INVALID_CHALLENGE_PRICE");
  const club = await ownedClub(userId);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return prisma.$transaction(async (tx) => {
    let groupId: string | null = null;
    if (groupTelegramId) {
      const group = await tx.telegramGroup.findUnique({
        where: { telegramId: groupTelegramId },
        include: { memberships: { where: { userId }, select: { id: true } } },
      });
      if (!group || group.memberships.length === 0) throw new PyramidLeagueError("GROUP_MEMBERSHIP_REQUIRED");
      if (!group.isActive || group.isSuspended) throw new PyramidLeagueError("GROUP_INACTIVE");
      groupId = group.id;
    }

    const existing = await tx.friendlyChallenge.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.creatorUserId !== userId || existing.creatorClubId !== club.id || existing.groupId !== groupId) {
        throw new PyramidLeagueError("IDEMPOTENCY_CONFLICT");
      }
      const usage = await tx.challengeDailyUsage.findUnique({ where: { userId_usageDate: { userId, usageDate: day } } });
      return {
        challenge: existing, asset: existing.chargeAsset, goldCost: existing.goldCost.toString(),
        remaining: {
          free: Math.max(0, 3 - (usage?.freeUsed ?? 0)),
          gold: Math.max(0, 2 - (usage?.goldUsed ?? 0)),
          purchased: usage?.purchasedCredits ?? 0,
        },
        replayed: true,
      };
    }

    const usage = await tx.challengeDailyUsage.upsert({
      where: { userId_usageDate: { userId, usageDate: day } },
      create: { userId, usageDate: day }, update: {},
    });
    let asset: "FREE" | "GOLD" | "PURCHASED";
    let chargedGold = 0n;
    if (usage.freeUsed < 3) {
      asset = "FREE";
      await tx.challengeDailyUsage.update({ where: { id: usage.id }, data: { freeUsed: { increment: 1 } } });
    } else if (usage.goldUsed < 2) {
      const wallet = await tx.wallet.findUnique({ where: { userId_asset: { userId, asset: "GOLD" } } });
      if (wallet && wallet.balance >= goldCost) {
        asset = "GOLD";
        const debited = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
          data: { balance: { decrement: goldCost }, version: { increment: 1 } },
        });
        if (debited.count !== 1) throw new PyramidLeagueError("CONCURRENT_MODIFICATION");
        chargedGold = goldCost;
        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: `friendly-challenge:${userId}:${idempotencyKey}`,
            userId, asset: "GOLD", direction: "DEBIT", amount: goldCost,
            reason: "FRIENDLY_CHALLENGE_CREATE", referenceType: "FRIENDLY_CHALLENGE", referenceId: idempotencyKey,
          },
        });
        await tx.challengeDailyUsage.update({ where: { id: usage.id }, data: { goldUsed: { increment: 1 } } });
      } else if (usage.purchasedCredits > 0) {
        asset = "PURCHASED";
        await tx.challengeDailyUsage.update({ where: { id: usage.id }, data: { purchasedCredits: { decrement: 1 } } });
      } else {
        throw new PyramidLeagueError("INSUFFICIENT_GOLD");
      }
    } else if (usage.purchasedCredits > 0) {
      asset = "PURCHASED";
      await tx.challengeDailyUsage.update({ where: { id: usage.id }, data: { purchasedCredits: { decrement: 1 } } });
    } else {
      throw new PyramidLeagueError("DAILY_CHALLENGE_LIMIT_REACHED");
    }

    const token = randomBytes(18).toString("base64url");
    const challenge = await tx.friendlyChallenge.create({
      data: {
        token, idempotencyKey, chargeAsset: asset, goldCost: chargedGold,
        creatorUserId: userId, creatorClubId: club.id, groupId,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      },
    });
    const updatedUsage = await tx.challengeDailyUsage.findUniqueOrThrow({
      where: { userId_usageDate: { userId, usageDate: day } },
    });
    return {
      challenge, asset, goldCost: chargedGold.toString(),
      remaining: {
        free: Math.max(0, 3 - updatedUsage.freeUsed),
        gold: Math.max(0, 2 - updatedUsage.goldUsed),
        purchased: updatedUsage.purchasedCredits,
      },
      replayed: false,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function acceptFriendlyChallenge(userId: string, token: string, now = new Date()) {
  const opponent = await ownedClub(userId);
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.friendlyChallenge.findUnique({
      where: { token },
      include: { club: { select: { id: true } }, group: { select: { id: true, isActive: true, isSuspended: true } } },
    });
    if (!challenge) throw new PyramidLeagueError("FRIENDLY_CHALLENGE_NOT_FOUND");
    if (challenge.creatorUserId === userId) throw new PyramidLeagueError("CANNOT_ACCEPT_OWN_CHALLENGE");

    if (challenge.status === "ACCEPTED" && challenge.matchId) {
      const existingMatch = await tx.footballMatch.findUnique({ where: { id: challenge.matchId } });
      if (!existingMatch || existingMatch.awayClubId !== opponent.id) {
        throw new PyramidLeagueError("FRIENDLY_CHALLENGE_ALREADY_ACCEPTED");
      }
      return { match: existingMatch, replayed: true };
    }
    if (challenge.status !== "OPEN" || challenge.expiresAt <= now) {
      throw new PyramidLeagueError("FRIENDLY_CHALLENGE_EXPIRED");
    }

    if (challenge.groupId) {
      if (!challenge.group?.isActive || challenge.group.isSuspended) throw new PyramidLeagueError("GROUP_INACTIVE");
      const membership = await tx.groupMembership.findUnique({
        where: { groupId_userId: { groupId: challenge.groupId, userId } }, select: { id: true },
      });
      if (!membership) throw new PyramidLeagueError("GROUP_MEMBERSHIP_REQUIRED");
    }

    const creatorClub = await tx.club.findUnique({
      where: { id: challenge.creatorClubId },
      select: { id: true, players: { where: { status: "ACTIVE" }, select: { position: true } } },
    });
    if (!creatorClub || creatorClub.players.length < 11 || !creatorClub.players.some((player) => player.position === "GK")) {
      throw new PyramidLeagueError("ALL_TEAMS_NEED_VALID_LINEUPS");
    }

    const clubIds = [challenge.creatorClubId, opponent.id];
    const overlap = await tx.footballMatch.findFirst({
      where: {
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledAt: { gte: new Date(now.getTime() - 2 * 60 * 60_000), lte: new Date(now.getTime() + 2 * 60 * 60_000) },
        OR: [{ homeClubId: { in: clubIds } }, { awayClubId: { in: clubIds } }],
      },
      select: { id: true },
    });
    if (overlap) throw new PyramidLeagueError("CLUB_ALREADY_HAS_MATCH_IN_WINDOW");

    const claimed = await tx.friendlyChallenge.updateMany({
      where: { id: challenge.id, status: "OPEN", expiresAt: { gt: now } },
      data: { status: "ACCEPTED" },
    });
    if (claimed.count !== 1) throw new PyramidLeagueError("FRIENDLY_CHALLENGE_ALREADY_ACCEPTED");

    const match = await tx.footballMatch.create({
      data: {
        idempotencyKey: `challenge:${challenge.id}`, type: "FRIENDLY", homeClubId: challenge.creatorClubId,
        awayClubId: opponent.id, scheduledAt: new Date(now.getTime() + 5 * 60_000), seed: `challenge:${challenge.id}`,
        rulesSnapshot: { ...LEAGUE_RULES, penaltiesOnDraw: false },
      },
    });
    await tx.friendlyChallenge.update({ where: { id: challenge.id }, data: { matchId: match.id } });
    return { match, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function grantPurchasedChallengeCredits(userId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new PyramidLeagueError("INVALID_CHALLENGE_CREDIT_QUANTITY");
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  return prisma.challengeDailyUsage.upsert({
    where: { userId_usageDate: { userId, usageDate: day } },
    create: { userId, usageDate: day, purchasedCredits: quantity },
    update: { purchasedCredits: { increment: quantity } },
  });
}


export async function getFriendlyChallengeInfo(token: string) {
  const challenge = await prisma.friendlyChallenge.findUnique({
    where: { token }, include: { club: { select: { name: true, level: true, reputation: true } }, group: { select: { title: true, telegramId: true, isActive: true, isSuspended: true } } },
  });
  if (!challenge) throw new PyramidLeagueError("FRIENDLY_CHALLENGE_NOT_FOUND");
  if (challenge.status === "OPEN" && challenge.expiresAt <= new Date()) {
    await prisma.friendlyChallenge.updateMany({ where: { id: challenge.id, status: "OPEN" }, data: { status: "EXPIRED" } });
    throw new PyramidLeagueError("FRIENDLY_CHALLENGE_EXPIRED");
  }
  if (challenge.group && (!challenge.group.isActive || challenge.group.isSuspended)) throw new PyramidLeagueError("GROUP_INACTIVE");
  return { id: challenge.id, token: challenge.token, status: challenge.status, expiresAt: challenge.expiresAt.toISOString(), creatorClub: challenge.club, groupTitle: challenge.group?.title ?? null, groupTelegramId: challenge.group?.telegramId ?? null };
}

export async function markLeagueNoticesRead(userId: string) {
  const result = await prisma.leagueNotice.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return { markedRead: result.count };
}


export async function processDuePromotionOffers(now = new Date(), limit = 50) {
  const pendingLeagues = await prisma.pyramidLeague.findMany({
    where: { promotionProcessedAt: null, competition: { status: "COMPLETED" } },
    orderBy: { createdAt: "asc" }, take: limit, select: { competitionId: true },
  });
  let completedLeagues = 0;
  for (const pending of pendingLeagues) {
    try {
      const result = await processPyramidLeagueCompletion(pending.competitionId, now);
      if (result.processed) completedLeagues += 1;
    } catch (error) {
      console.warn("Could not finalize pyramid league:", pending.competitionId, error);
    }
  }
  const due = await prisma.leaguePromotionOffer.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" }, take: limit,
    select: { id: true },
  });
  let accepted = 0;
  for (const item of due) {
    const didAccept = await prisma.$transaction(async (tx) => {
      const offer = await tx.leaguePromotionOffer.findUnique({
        where: { id: item.id },
        include: { league: true, club: { select: { id: true, ownerId: true } } },
      });
      if (!offer || offer.status !== "PENDING" || offer.expiresAt > now) return false;
      const updated = await tx.leaguePromotionOffer.updateMany({
        where: { id: offer.id, status: "PENDING", expiresAt: { lte: now } },
        data: { status: "ACCEPTED", resolvedAt: now },
      });
      if (updated.count !== 1) return false;
      const season = offer.league.season + 1;
      await tx.pyramidLeagueApplication.upsert({
        where: { clubId_tier_season: { clubId: offer.club.id, tier: offer.targetTier, season } },
        create: { userId: offer.club.ownerId, clubId: offer.club.id, tier: offer.targetTier, season },
        update: { status: "QUEUED", appliedAt: now },
      });
      await adjustPlayerValues(tx, offer.club.id, offer.league.tier, offer.targetTier);
      await addNotice(tx, offer.club.ownerId, "PROMOTION_AUTO_ACCEPTED", "صعود به‌صورت خودکار تأیید شد", `مهلت پاسخ به پیشنهاد صعود پایان یافت؛ تیم شما در فصل ${season} به ${leagueTier(offer.targetTier).name} منتقل شد.`, offer.id);
      await assignQueueIfReady(tx, offer.targetTier, season, now);
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (didAccept) accepted += 1;
  }
  return { completedLeagues, processed: due.length, accepted };
}
