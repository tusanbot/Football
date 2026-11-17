import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  advanceMatchSegment, applyMatchSubstitutions, calculateStadiumCapacity, resolveMatchCheckpoint,
  simulateFootballMatch, simulatePenaltyShootout,
  type MatchSegmentState, type MatchSide, type MatchTactics, type MatchTacticalInstruction,
  type MatchSubstitutionState, type MatchRules,
  defaultMatchRules, validateMatchRules,
} from "@football/domain";
import { prisma } from "../db.js";

const DAY_MS = 86_400_000;
export class MatchServiceError extends Error {
  constructor(public readonly code: string, public readonly details?: Record<string, string>) {
    super(code); this.name = "MatchServiceError";
  }
}
function aggregateCupScore<T extends { id: string; tieId: string | null; leg: number; homeScore: number | null; awayScore: number | null }>(
  match: T, fixtures: readonly T[],
) {
  if (!match.tieId || match.leg !== 2 || match.homeScore === null || match.awayScore === null) {
    return { aggregateHomeScore: null, aggregateAwayScore: null };
  }
  const firstLeg = fixtures.find((fixture) => fixture.tieId === match.tieId && fixture.leg === 1);
  if (!firstLeg || firstLeg.homeScore === null || firstLeg.awayScore === null) {
    return { aggregateHomeScore: null, aggregateAwayScore: null };
  }
  return {
    aggregateHomeScore: match.homeScore + firstLeg.awayScore,
    aggregateAwayScore: match.awayScore + firstLeg.homeScore,
  };
}
function rulesForMatch(match: { type: "FRIENDLY" | "LEAGUE" | "CUP"; rulesSnapshot: Prisma.JsonValue | null }): MatchRules {
  return validateMatchRules(match.rulesSnapshot ?? defaultMatchRules(match.type));
}
function keyValid(key: string) {
  if (!/^[A-Za-z0-9:_-]{12,128}$/.test(key)) throw new MatchServiceError("INVALID_IDEMPOTENCY_KEY");
}
function asTactics(club: { mentality: string; pressing: string; tempo: string; passingStyle: string }): MatchTactics {
  return {
    mentality: club.mentality as MatchTactics["mentality"],
    pressing: club.pressing as MatchTactics["pressing"],
    tempo: club.tempo as MatchTactics["tempo"],
    passingStyle: club.passingStyle as MatchTactics["passingStyle"],
  };
}
const matchClubInclude = {
  owner: { select: { id: true, telegramId: true } },
  coach: { select: { medicalSkill: true } },
  players: {
    where: { status: "ACTIVE" as const },
    orderBy: [{ lineupSlot: "asc" as const }, { overall: "desc" as const }],
    select: {
      id: true, firstName: true, lastName: true, position: true, overall: true, lineupSlot: true,
      morale: true, fitness: true, attributes: true, suspensionMatchesRemaining: true,
    },
  },
};
type LoadedClub = Prisma.ClubGetPayload<{ include: typeof matchClubInclude }>;
function isValidMatchSide(side: MatchSide): boolean {
  return side.players.length === 11 && side.players.some((player) => player.position === "GK");
}

function toSide(club: LoadedClub): MatchSide {
  const eligiblePlayers = club.players.filter((player) => player.suspensionMatchesRemaining === 0);
  const starters = eligiblePlayers.filter((player) => player.lineupSlot !== null)
    .sort((a, b) => (a.lineupSlot ?? 99) - (b.lineupSlot ?? 99));
  const bench = eligiblePlayers.filter((player) => player.lineupSlot === null)
    .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
  const selected = [...starters];
  if (!selected.some((player) => player.position === "GK")) {
    const reserveKeeper = bench.find((player) => player.position === "GK");
    if (reserveKeeper) {
      if (selected.length >= 11) selected[10] = reserveKeeper;
      else selected.push(reserveKeeper);
    }
  }
  for (const player of bench) {
    if (selected.length >= 11) break;
    if (!selected.some((item) => item.id === player.id)) selected.push(player);
  }
  return {
    clubId: club.id, clubName: club.name, formation: club.formation, tactics: asTactics(club),
    stadiumCapacity: calculateStadiumCapacity(club.stadiumLevel),
    ticketPrice: club.ticketPrice, reputation: club.reputation,
    coachMedicalSkill: club.coach?.medicalSkill ?? 0,
    players: selected.slice(0, 11).map((player) => ({
      id: player.id, name: player.firstName + " " + player.lastName,
      position: player.position, overall: player.overall, morale: player.morale,
      fitness: player.fitness,
      attributes: player.attributes as unknown as MatchSide["players"][number]["attributes"],
    })),
    bench: bench.filter((player) => !selected.some((starter) => starter.id === player.id)).slice(0, 7).map((player) => ({
      id: player.id, name: player.firstName + " " + player.lastName,
      position: player.position, overall: player.overall, morale: player.morale,
      fitness: player.fitness,
      attributes: player.attributes as unknown as MatchSide["players"][number]["attributes"],
    })),
  };
}
async function getOwnedClub(userId: string) {
  const club = await prisma.club.findUnique({ where: { ownerId: userId }, select: { id: true, name: true } });
  if (!club) throw new MatchServiceError("CLUB_NOT_FOUND");
  return club;
}
async function creditMatchCash(
  tx: Prisma.TransactionClient, club: { id: string; ownerId: string }, amount: bigint,
  key: string, reason: string, category: string, description: string, now: Date,
) {
  if (amount <= 0n) return;
  const wallet = await tx.wallet.findUnique({ where: { userId_asset: { userId: club.ownerId, asset: "CASH" } } });
  if (!wallet) throw new MatchServiceError("WALLET_NOT_FOUND");
  const updated = await tx.wallet.updateMany({
    where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
    data: { balance: { increment: amount }, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new MatchServiceError("CONCURRENT_MODIFICATION");
  await tx.ledgerTransaction.create({
    data: { idempotencyKey: key, userId: club.ownerId, asset: "CASH", direction: "CREDIT",
      amount, reason, referenceType: "FOOTBALL_MATCH", referenceId: key.split(":")[1] ?? null },
  });
  await tx.clubFinanceEntry.create({
    data: { idempotencyKey: "club-finance:" + key, clubId: club.id, category,
      direction: "CREDIT", amount, description, occurredAt: now },
  });
}
export async function listMatchOpponents(userId: string, search?: string) {
  const own = await getOwnedClub(userId);
  const query = search?.trim().slice(0, 80);
  const clubs = await prisma.club.findMany({
    where: {
      id: { not: own.id },
      players: { some: { lineupSlot: { not: null }, status: "ACTIVE" } },
      ...(query ? { OR: [
        { name: { contains: query, mode: "insensitive" } },
        { owner: { telegramId: query.replace(/^@/, "") } },
        ...(query.startsWith("@") ? [{ owner: { username: query.slice(1) } }] : []),
      ] } : {}),
    },
    include: {
      owner: { select: { telegramId: true, username: true, lastActiveAt: true } },
      players: { where: { status: "ACTIVE", suspensionMatchesRemaining: 0 }, select: { id: true, position: true } },
    },
    orderBy: query ? [{ reputation: "desc" }, { level: "desc" }] : [{ owner: { lastActiveAt: "desc" } }, { createdAt: "desc" }],
    take: query ? 25 : 10,
  });
  return clubs.filter((club) => club.players.length >= 11 && club.players.some((player) => player.position === "GK")).map((club) => ({
    id: club.id, name: club.name, level: club.level, reputation: club.reputation,
    ownerTelegramId: club.owner.telegramId, ownerUsername: club.owner.username,
    lastActiveAt: club.owner.lastActiveAt.toISOString(),
  }));
}
export async function createFriendlyMatch(userId: string, opponentClubId: string, idempotencyKey: string, scheduledAt = new Date()) {
  keyValid(idempotencyKey);
  if (scheduledAt.getTime() < Date.now() - 60_000 || scheduledAt.getTime() > Date.now() + 30 * DAY_MS) {
    throw new MatchServiceError("INVALID_MATCH_SCHEDULE");
  }
  return prisma.$transaction(async (tx) => {
    const own = await tx.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
    if (!own) throw new MatchServiceError("CLUB_NOT_FOUND");
    if (own.id === opponentClubId) throw new MatchServiceError("MATCH_TEAMS_MUST_DIFFER");

    const previous = await tx.footballMatch.findUnique({ where: { idempotencyKey } });
    if (previous) {
      if (previous.homeClubId !== own.id || previous.awayClubId !== opponentClubId || previous.type !== "FRIENDLY") {
        throw new MatchServiceError("IDEMPOTENCY_CONFLICT");
      }
      return { match: previous, replayed: true };
    }

    const [home, away] = await Promise.all([
      tx.club.findUnique({ where: { id: own.id }, include: matchClubInclude }),
      tx.club.findUnique({ where: { id: opponentClubId }, include: matchClubInclude }),
    ]);
    if (!home || !away) throw new MatchServiceError("OPPONENT_NOT_FOUND");
    if (home.players.length < 11 || away.players.length < 11) throw new MatchServiceError("BOTH_CLUBS_NEED_VALID_LINEUPS");
    const homeSide = toSide(home); const awaySide = toSide(away);
    if (!isValidMatchSide(homeSide) || !isValidMatchSide(awaySide)) throw new MatchServiceError("BOTH_CLUBS_NEED_VALID_LINEUPS");

    const overlap = await tx.footballMatch.findFirst({
      where: {
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledAt: {
          gte: new Date(scheduledAt.getTime() - 2 * 60 * 60_000),
          lte: new Date(scheduledAt.getTime() + 2 * 60 * 60_000),
        },
        OR: [{ homeClubId: { in: [own.id, opponentClubId] } }, { awayClubId: { in: [own.id, opponentClubId] } }],
      },
      select: { id: true },
    });
    if (overlap) throw new MatchServiceError("CLUB_ALREADY_HAS_MATCH_IN_WINDOW");

    const match = await tx.footballMatch.create({
      data: {
        idempotencyKey, type: "FRIENDLY", homeClubId: own.id, awayClubId: opponentClubId,
        scheduledAt, seed: idempotencyKey + ":" + randomUUID(), rulesSnapshot: defaultMatchRules("FRIENDLY"),
      },
    });
    return { match, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function createLeague(userId: string, name: string, maxTeams: number, idempotencyKey: string, format: "LEAGUE" | "CUP" = "LEAGUE", inputRules?: MatchRules, cupLegs = 1) {
  keyValid(idempotencyKey);
  if (format === "CUP" && ![4, 8].includes(maxTeams)) throw new MatchServiceError("CUP_SIZE_MUST_BE_FOUR_OR_EIGHT");
  if (format === "LEAGUE" && (maxTeams < 4 || maxTeams > 10)) throw new MatchServiceError("INVALID_LEAGUE_SIZE");
  if (!Number.isInteger(cupLegs) || ![1, 2].includes(cupLegs) || (format === "LEAGUE" && cupLegs !== 1)) throw new MatchServiceError("INVALID_CUP_LEGS");
  const club = await getOwnedClub(userId);
  const rules = validateMatchRules(inputRules ?? defaultMatchRules(format));
  if (format === "LEAGUE" && rules.penaltiesOnDraw) throw new MatchServiceError("PENALTIES_NOT_ALLOWED_FOR_LEAGUE");
  if (format === "CUP" && !rules.penaltiesOnDraw) throw new MatchServiceError("CUP_REQUIRES_PENALTIES");
  const existing = await prisma.competition.findUnique({ where: { idempotencyKey } });
  if (existing) {
    // Rules may be edited after creation; replaying the original create command
    // must return that competition rather than treating its current rules as a new payload.
    if (existing.createdByClubId !== club.id || existing.name !== name
      || existing.maxTeams !== maxTeams || existing.format !== format || existing.cupLegs !== cupLegs) {
      throw new MatchServiceError("IDEMPOTENCY_CONFLICT");
    }
    return { competition: existing, replayed: true };
  }
  const competition = await prisma.competition.create({
    data: {
      idempotencyKey, name, season: new Date().getUTCFullYear(), format, maxTeams, cupLegs, rules, createdByClubId: club.id,
      entries: { create: { clubId: club.id } },
    },
  });
  return { competition, replayed: false };
}
export async function updateCompetitionRules(userId: string, competitionId: string, input: MatchRules) {
  const club = await getOwnedClub(userId);
  const rules = validateMatchRules(input);
  return prisma.$transaction(async (tx) => {
    const competition = await tx.competition.findUnique({ where: { id: competitionId } });
    if (!competition) throw new MatchServiceError("COMPETITION_NOT_FOUND");
    if (competition.createdByClubId !== club.id) throw new MatchServiceError("ONLY_CREATOR_CAN_START");
    if (competition.status !== "REGISTRATION") throw new MatchServiceError("COMPETITION_RULES_LOCKED");
    if (competition.format !== "CUP" && rules.penaltiesOnDraw) throw new MatchServiceError("PENALTIES_NOT_ALLOWED_FOR_LEAGUE");
    if (competition.format === "CUP" && !rules.penaltiesOnDraw) throw new MatchServiceError("CUP_REQUIRES_PENALTIES");
    await tx.competition.update({ where: { id: competitionId }, data: { rules } });
    return { competitionId, rules };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function joinLeague(userId: string, competitionId: string) {
  const club = await getOwnedClub(userId);
  return prisma.$transaction(async (tx) => {
    const competition = await tx.competition.findUnique({ where: { id: competitionId }, include: { entries: true } });
    if (!competition) throw new MatchServiceError("COMPETITION_NOT_FOUND");
    const existing = competition.entries.find((entry) => entry.clubId === club.id);
    if (existing) return { joined: true, replayed: true, teams: competition.entries.length };
    if (competition.status !== "REGISTRATION") throw new MatchServiceError("COMPETITION_NOT_OPEN");
    if (competition.entries.length >= competition.maxTeams) throw new MatchServiceError("COMPETITION_FULL");
    await tx.competitionEntry.create({ data: { competitionId, clubId: club.id } });
    return { joined: true, replayed: false, teams: competition.entries.length + 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function startLeague(userId: string, competitionId: string, now = new Date()) {
  const club = await getOwnedClub(userId);
  return prisma.$transaction(async (tx) => {
    const competition = await tx.competition.findUnique({
      where: { id: competitionId },
      include: {
        entries: {
          include: {
            club: {
              select: {
                id: true,
                players: { where: { status: "ACTIVE" }, select: { id: true, position: true } },
              },
            },
          },
        },
      },
    });
    if (!competition) throw new MatchServiceError("COMPETITION_NOT_FOUND");
    if (competition.createdByClubId !== club.id) throw new MatchServiceError("ONLY_CREATOR_CAN_START");
    if (competition.status !== "REGISTRATION") {
      if (competition.status === "ACTIVE" || competition.status === "COMPLETED") {
        const existingFixtures = await tx.footballMatch.findMany({ where: { competitionId }, select: { round: true } });
        return {
          fixturesCreated: existingFixtures.length,
          rounds: Math.max(0, ...existingFixtures.map((fixture) => fixture.round ?? 0)),
          teams: competition.entries.length,
          replayed: true,
        };
      }
      throw new MatchServiceError("COMPETITION_NOT_OPEN");
    }
    if (competition.entries.length < 4) throw new MatchServiceError("LEAGUE_NEEDS_FOUR_TEAMS");
    if (competition.entries.some((entry) => entry.club.players.length < 11 || !entry.club.players.some((player) => player.position === "GK"))) throw new MatchServiceError("ALL_TEAMS_NEED_VALID_LINEUPS");
    competition.entries.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
    const teams = competition.entries.map((entry) => entry.clubId);
    if (competition.format === "CUP") {
      if (![4, 8].includes(competition.maxTeams) || teams.length !== competition.maxTeams) {
        throw new MatchServiceError("CUP_REQUIRES_FULL_FOUR_OR_EIGHT_TEAM_BRACKET");
      }
      const firstRoundFixtures = Array.from({ length: teams.length / 2 }, (_, index) => {
        const homeClubId = teams[index]!;
        const awayClubId = teams[teams.length - 1 - index]!;
        const tieId = `cup:${competition.id}:r1:t${index + 1}`;
        return Array.from({ length: competition.cupLegs }, (_, legIndex) => {
          const leg = legIndex + 1;
          const legHome = leg === 1 ? homeClubId : awayClubId;
          const legAway = leg === 1 ? awayClubId : homeClubId;
          const idempotencyKey = tieId + `:leg${leg}`;
          return {
            homeClubId: legHome, awayClubId: legAway, round: 1, type: "CUP" as const,
            competitionId, rulesSnapshot: validateMatchRules(competition.rules ?? defaultMatchRules("CUP")),
            tieId: competition.cupLegs === 2 ? tieId : null, leg, scheduledAt: new Date(now.getTime() + leg * 3 * DAY_MS),
            seed: idempotencyKey, idempotencyKey,
          };
        });
      }).flat();
      await tx.footballMatch.createMany({ data: firstRoundFixtures });
      const updated = await tx.competition.updateMany({
        where: { id: competitionId, status: "REGISTRATION" },
        data: { status: "ACTIVE", startsAt: firstRoundFixtures[0]!.scheduledAt },
      });
      if (updated.count !== 1) throw new MatchServiceError("COMPETITION_NOT_OPEN");
      return { fixturesCreated: firstRoundFixtures.length, rounds: Math.log2(teams.length), teams: teams.length, cupLegs: competition.cupLegs, replayed: false };
    }
    const slots: Array<string | null> = [...teams];
    if (slots.length % 2) slots.push(null);
    const rounds = slots.length - 1;
    const fixtures: Array<{ homeClubId: string; awayClubId: string; round: number; scheduledAt: Date; seed: string; idempotencyKey: string }> = [];
    for (let round = 0; round < rounds; round++) {
      for (let index = 0; index < slots.length / 2; index++) {
        const first = slots[index]!;
        const second = slots[slots.length - 1 - index]!;
        if (!first || !second) continue;
        const swap = (round + index) % 2 === 1;
        const homeClubId = swap ? second : first;
        const awayClubId = swap ? first : second;
        const idempotencyKey = `league:${competition.id}:r${round + 1}:${homeClubId}:${awayClubId}`;
        fixtures.push({
          homeClubId, awayClubId, round: round + 1,
          scheduledAt: new Date(now.getTime() + (round + 1) * 3 * DAY_MS),
          seed: idempotencyKey, idempotencyKey,
        });
      }
      const fixed = slots[0]!;
      const rotating = slots.slice(1);
      rotating.unshift(rotating.pop()!);
      slots.splice(0, slots.length, fixed, ...rotating);
    }
    await tx.footballMatch.createMany({ data: fixtures.map((fixture) => ({
      ...fixture, type: "LEAGUE", competitionId,
      rulesSnapshot: validateMatchRules(competition.rules ?? defaultMatchRules("LEAGUE")),
    })) });
    const updated = await tx.competition.updateMany({
      where: { id: competitionId, status: "REGISTRATION" },
      data: { status: "ACTIVE", startsAt: fixtures[0]?.scheduledAt ?? now },
    });
    if (updated.count !== 1) throw new MatchServiceError("COMPETITION_NOT_OPEN");
    return { fixturesCreated: fixtures.length, rounds, teams: teams.length, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function listOpenLeagues(userId: string) {
  const club = await getOwnedClub(userId);
  const competitions = await prisma.competition.findMany({
    where: { status: "REGISTRATION" },
    include: { entries: { select: { clubId: true, club: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" }, take: 30,
  });
  return competitions.map((competition) => ({
    id: competition.id, name: competition.name, season: competition.season, format: competition.format, cupLegs: competition.cupLegs,
    rules: validateMatchRules(competition.rules ?? defaultMatchRules(competition.format)),
    status: competition.status, maxTeams: competition.maxTeams,
    teams: competition.entries.length,
    joined: competition.entries.some((entry) => entry.clubId === club.id),
    isCreator: competition.createdByClubId === club.id,
    creator: competition.entries.find((entry) => entry.clubId === competition.createdByClubId)?.club.name ?? "Club",
  }));
}
export async function getLeague(userId: string, competitionId: string) {
  const club = await getOwnedClub(userId);
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
    include: {
      entries: { include: { club: { select: { id: true, name: true, level: true } } }, orderBy: { points: "desc" } },
      matches: { include: { homeClub: { select: { id: true, name: true } }, awayClub: { select: { id: true, name: true } } }, orderBy: [{ round: "asc" }, { scheduledAt: "asc" }] },
    },
  });
  if (!competition) throw new MatchServiceError("COMPETITION_NOT_FOUND");
  if (!competition.entries.some((entry) => entry.clubId === club.id)) throw new MatchServiceError("NOT_COMPETITION_MEMBER");
  competition.entries.sort((a, b) => b.points - a.points
    || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
    || b.goalsFor - a.goalsFor || a.club.name.localeCompare(b.club.name));
  return {
    competition: { id: competition.id, name: competition.name, season: competition.season, format: competition.format, cupLegs: competition.cupLegs, rules: validateMatchRules(competition.rules ?? defaultMatchRules(competition.format)), status: competition.status, startsAt: competition.startsAt?.toISOString() ?? null },
    standings: competition.entries.map((entry, index) => ({
      position: index + 1, clubId: entry.clubId, clubName: entry.club.name, played: entry.played,
      won: entry.won, drawn: entry.drawn, lost: entry.lost, goalsFor: entry.goalsFor,
      goalsAgainst: entry.goalsAgainst, goalDifference: entry.goalsFor - entry.goalsAgainst, points: entry.points,
    })),
    matches: competition.matches.map((match) => ({
      id: match.id, round: match.round, leg: match.leg, tieId: match.tieId, scheduledAt: match.scheduledAt.toISOString(), status: match.status,
      homeClub: match.homeClub, awayClub: match.awayClub, homeScore: match.homeScore, awayScore: match.awayScore,
      ...aggregateCupScore(match, competition.matches),
      rules: validateMatchRules(match.rulesSnapshot ?? defaultMatchRules(match.type)), homePenalties: match.homePenalties, awayPenalties: match.awayPenalties, winnerClubId: match.winnerClubId,
    })),
  };
}
export async function listClubMatches(userId: string) {
  const club = await getOwnedClub(userId);
  const [matches, competitions] = await Promise.all([
    prisma.footballMatch.findMany({
      where: { OR: [{ homeClubId: club.id }, { awayClubId: club.id }] },
      include: {
        homeClub: { select: { id: true, name: true } }, awayClub: { select: { id: true, name: true } },
        events: { orderBy: { sequence: "asc" } },
        runtime: { select: { status: true, currentMinute: true, nextActionAt: true, completedAt: true, simulationState: true, kickoffSnapshot: true } },
        checkpoints: {
          orderBy: { minute: "asc" },
          select: {
            checkpointKey: true, kind: true, minute: true, status: true,
            openedAt: true, decisionDeadlineAt: true, nextSegmentAt: true, resolvedAt: true,
            decisions: { select: { clubId: true, submittedAt: true } },
          },
        },
      }, orderBy: { scheduledAt: "desc" }, take: 50,
    }),
    prisma.competition.findMany({
      where: { entries: { some: { clubId: club.id } } },
      select: { id: true, name: true, season: true, format: true, cupLegs: true, status: true }, orderBy: { createdAt: "desc" }, take: 20,
    }),
  ]);
  const eventPlayerIds = [...new Set(matches.flatMap((match) => match.events.flatMap((event) =>
    [event.playerId, ...(event.relatedPlayerId ? [event.relatedPlayerId] : [])])))];
  const eventPlayers = await prisma.player.findMany({
    where: { id: { in: eventPlayerIds } }, select: { id: true, firstName: true, lastName: true },
  });
  const playerNames = new Map(eventPlayers.map((player) => [player.id, player.firstName + " " + player.lastName]));
  return {
    matches: matches.map((match) => ({
      id: match.id, type: match.type, status: match.status, round: match.round, leg: match.leg, tieId: match.tieId,
      ...aggregateCupScore(match, matches),
      rules: validateMatchRules(match.rulesSnapshot ?? defaultMatchRules(match.type)), simulationVersion: match.simulationVersion, scheduledAt: match.scheduledAt.toISOString(),
      runtime: match.runtime ? (() => {
        const simulation = match.runtime.simulationState as unknown as {
          segment?: { home?: { side?: MatchSide }; away?: { side?: MatchSide } };
          substitutions?: {
            home?: { substitutionsUsed?: number };
            away?: { substitutionsUsed?: number };
          };
        } | null;
        const kickoff = match.runtime.kickoffSnapshot as unknown as { home?: MatchSide; away?: MatchSide } | null;
        const home = simulation?.segment?.home?.side ?? kickoff?.home;
        const away = simulation?.segment?.away?.side ?? kickoff?.away;
        return {
          status: match.runtime.status, currentMinute: match.runtime.currentMinute,
          nextActionAt: match.runtime.nextActionAt?.toISOString() ?? null,
          completedAt: match.runtime.completedAt?.toISOString() ?? null,
          mySubstitutionsUsed: Number(match.homeClubId === club.id
            ? simulation?.substitutions?.home?.substitutionsUsed ?? 0
            : simulation?.substitutions?.away?.substitutionsUsed ?? 0),
          lineups: home && away ? {
            home: { formation: home.formation, tactics: home.tactics, players: home.players.map(({ id, name, position, overall }) => ({ id, name, position, overall })), bench: (home.bench ?? []).map(({ id, name, position, overall }) => ({ id, name, position, overall })) },
            away: { formation: away.formation, tactics: away.tactics, players: away.players.map(({ id, name, position, overall }) => ({ id, name, position, overall })), bench: (away.bench ?? []).map(({ id, name, position, overall }) => ({ id, name, position, overall })) },
          } : null,
        };
      })() : null,
      checkpoints: match.checkpoints.map((checkpoint) => ({
        checkpointKey: checkpoint.checkpointKey, kind: checkpoint.kind, minute: checkpoint.minute,
        status: checkpoint.status, openedAt: checkpoint.openedAt.toISOString(),
        decisionDeadlineAt: checkpoint.decisionDeadlineAt.toISOString(),
        nextSegmentAt: checkpoint.nextSegmentAt.toISOString(),
        resolvedAt: checkpoint.resolvedAt?.toISOString() ?? null,
        homeDecisionSubmitted: checkpoint.decisions.some((decision) => decision.clubId === match.homeClubId),
        awayDecisionSubmitted: checkpoint.decisions.some((decision) => decision.clubId === match.awayClubId),
      })),
      homeClub: match.homeClub, awayClub: match.awayClub, homeScore: match.homeScore, awayScore: match.awayScore,
      attendance: match.attendance, ticketRevenue: match.ticketRevenue.toString(),
      homePenalties: match.homePenalties, awayPenalties: match.awayPenalties, winnerClubId: match.winnerClubId,
      events: match.events.map((event) => ({
        minute: event.minute, type: event.type, teamId: event.teamId, playerId: event.playerId,
        relatedPlayerId: event.relatedPlayerId, detail: event.detail,
        playerName: playerNames.get(event.playerId) ?? "Player",
        relatedPlayerName: event.relatedPlayerId ? playerNames.get(event.relatedPlayerId) ?? null : null,
      })),
    })),
    competitions,
  };
}
async function advanceCupRound(competitionId: string, round: number, now: Date) {
  const competition = await prisma.competition.findUnique({
    where: { id: competitionId },
    select: { status: true, format: true, cupLegs: true, rules: true },
  });
  if (!competition || competition.status !== "ACTIVE" || competition.format !== "CUP") return;
  const currentRound = await prisma.footballMatch.findMany({
    where: { competitionId, round },
    select: {
      id: true, tieId: true, leg: true, homeClubId: true, awayClubId: true,
      homeScore: true, awayScore: true, winnerClubId: true, status: true,
    },
    orderBy: [{ tieId: "asc" }, { leg: "asc" }, { id: "asc" }],
  });
  if (currentRound.length === 0) return;
  const ties = new Map<string, typeof currentRound>();
  for (const fixture of currentRound) {
    const tieId = fixture.tieId ?? "legacy:" + fixture.id;
    ties.set(tieId, [...(ties.get(tieId) ?? []), fixture]);
  }
  const resolvedWinners: string[] = [];
  for (const [tieId, fixtures] of [...ties.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (fixtures.some((fixture) => fixture.status !== "COMPLETED")) return;
    if (competition.cupLegs === 2) {
      if (fixtures.length !== 2) return;
      const decidingLeg = fixtures.find((fixture) => fixture.leg === 2);
      if (!decidingLeg?.winnerClubId) return;
      resolvedWinners.push(decidingLeg.winnerClubId);
    } else {
      if (fixtures.length !== 1 || !fixtures[0]!.winnerClubId) return;
      resolvedWinners.push(fixtures[0]!.winnerClubId);
    }
  }
  if (resolvedWinners.length === 1) {
    await prisma.competition.updateMany({
      where: { id: competitionId, status: "ACTIVE" },
      data: { status: "COMPLETED", completedAt: now },
    });
    return;
  }
  const nextRound = round + 1;
  const existingNextRound = await prisma.footballMatch.count({ where: { competitionId, round: nextRound } });
  if (existingNextRound > 0) return;
  const rulesSnapshot = validateMatchRules(competition.rules ?? defaultMatchRules("CUP"));
  const fixtures = [];
  for (let index = 0; index < resolvedWinners.length; index += 2) {
    const homeClubId = resolvedWinners[index]!;
    const awayClubId = resolvedWinners[index + 1]!;
    const tieId = `cup:${competitionId}:r${nextRound}:t${index / 2 + 1}`;
    for (let legIndex = 0; legIndex < competition.cupLegs; legIndex++) {
      const leg = legIndex + 1;
      const legHome = leg === 1 ? homeClubId : awayClubId;
      const legAway = leg === 1 ? awayClubId : homeClubId;
      const idempotencyKey = tieId + `:leg${leg}`;
      fixtures.push({
        idempotencyKey, type: "CUP" as const, competitionId, round: nextRound,
        homeClubId: legHome, awayClubId: legAway, tieId: competition.cupLegs === 2 ? tieId : null, leg,
        rulesSnapshot,
        scheduledAt: new Date(now.getTime() + leg * 3 * DAY_MS), seed: idempotencyKey,
      });
    }
  }
  await prisma.footballMatch.createMany({ data: fixtures, skipDuplicates: true });
}

export async function submitMatchCheckpointDecision(userId: string, matchId: string, checkpointKey: string,
  idempotencyKey: string, instruction: MatchTacticalInstruction, now = new Date()) {
  keyValid(idempotencyKey);
  if (!checkpointKey.trim() || checkpointKey.length > 100) throw new MatchServiceError("INVALID_MATCH_CHECKPOINT");
  return prisma.$transaction(async (tx) => {
    const match = await tx.footballMatch.findUnique({ where: { id: matchId },
      include: { homeClub: { select: { id: true, ownerId: true } }, awayClub: { select: { id: true, ownerId: true } } } });
    if (!match) throw new MatchServiceError("MATCH_NOT_FOUND");
    const club = match.homeClub.ownerId === userId ? match.homeClub : match.awayClub.ownerId === userId ? match.awayClub : null;
    if (!club) throw new MatchServiceError("NOT_MATCH_PARTICIPANT");
    const checkpoint = await tx.matchTacticalCheckpoint.findUnique({ where: { matchId_checkpointKey: { matchId, checkpointKey } } });
    if (!checkpoint) throw new MatchServiceError("MATCH_CHECKPOINT_NOT_FOUND");
    const previous = await tx.matchTacticalDecision.findUnique({ where: { idempotencyKey } });
    if (previous) {
      if (previous.checkpointId !== checkpoint.id || previous.clubId !== club.id || previous.submittedByUserId !== userId)
        throw new MatchServiceError("IDEMPOTENCY_CONFLICT");
      return { decision: previous, replayed: true };
    }
    const cutoff = Math.min(checkpoint.decisionDeadlineAt.getTime(), checkpoint.nextSegmentAt.getTime());
    if (checkpoint.status !== "OPEN" || now.getTime() < checkpoint.openedAt.getTime() || now.getTime() >= cutoff)
      throw new MatchServiceError("MATCH_CHECKPOINT_CLOSED");
    const decision = await tx.matchTacticalDecision.create({ data: {
      idempotencyKey, checkpointId: checkpoint.id, clubId: club.id, submittedByUserId: userId,
      instruction: instruction as Prisma.InputJsonValue, submittedAt: now,
    } });
    return { decision, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Atomically lease due runtimes; expired leases are recoverable after worker crashes. */
export async function claimDueMatchRuntimes(workerId: string, now = new Date(), leaseMs = 30_000, limit = 10) {
  if (!workerId.trim() || workerId.length > 100 || !Number.isInteger(leaseMs) || leaseMs < 1_000
    || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new MatchServiceError("INVALID_MATCH_WORKER_LEASE");
  const candidates = await prisma.matchRuntime.findMany({ where: {
    status: { in: ["QUEUED", "RUNNING", "AWAITING_CHECKPOINT"] }, nextActionAt: { lte: now },
    OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
  }, orderBy: [{ nextActionAt: "asc" }, { createdAt: "asc" }], take: limit, select: { id: true } });
  const claimed = [];
  for (const candidate of candidates) {
    const token = randomUUID(), leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const updated = await prisma.matchRuntime.updateMany({ where: {
      id: candidate.id, status: { in: ["QUEUED", "RUNNING", "AWAITING_CHECKPOINT"] },
      nextActionAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    }, data: { leaseOwner: workerId, leaseToken: token, leaseExpiresAt } });
    if (updated.count !== 1) continue;
    const runtime = await prisma.matchRuntime.findUnique({ where: { id: candidate.id } });
    if (runtime) claimed.push({ runtime, lease: { owner: workerId, token, expiresAt: leaseExpiresAt } });
  }
  return claimed;
}
export async function releaseMatchRuntimeLease(runtimeId: string, leaseToken: string,
  nextActionAt: Date | null, lastError: string | null = null) {
  const result = await prisma.matchRuntime.updateMany({ where: { id: runtimeId, leaseToken },
    data: { leaseOwner: null, leaseToken: null, leaseExpiresAt: null, nextActionAt, lastError } });
  return result.count === 1;
}

export async function simulateScheduledMatch(userId: string, matchId: string, now = new Date()) {
  const settlement = await prisma.$transaction(async (tx) => {
    const match = await tx.footballMatch.findUnique({ where: { id: matchId } });
    if (!match) throw new MatchServiceError("MATCH_NOT_FOUND");
    const [home, away] = await Promise.all([
      tx.club.findUnique({ where: { id: match.homeClubId }, include: matchClubInclude }),
      tx.club.findUnique({ where: { id: match.awayClubId }, include: matchClubInclude }),
    ]);
    if (!home || !away) throw new MatchServiceError("CLUB_NOT_FOUND");
    if (home.ownerId !== userId && away.ownerId !== userId) throw new MatchServiceError("NOT_MATCH_PARTICIPANT");
    if (match.status === "COMPLETED") {
      const completed = await tx.footballMatch.findUniqueOrThrow({
        where: { id: match.id },
        include: {
          homeClub: { select: { name: true } }, awayClub: { select: { name: true } },
          events: { orderBy: { sequence: "asc" } },
        },
      });
      const eventPlayerIds = [...new Set(completed.events.flatMap((event) =>
        [event.playerId, ...(event.relatedPlayerId ? [event.relatedPlayerId] : [])]))];
      const eventPlayers = await tx.player.findMany({
        where: { id: { in: eventPlayerIds } }, select: { id: true, firstName: true, lastName: true },
      });
      const names = new Map(eventPlayers.map((player) => [player.id, player.firstName + " " + player.lastName]));
      return {
        replayed: true, matchId: completed.id, competitionId: match.competitionId, homeClub: completed.homeClub.name,
        awayClub: completed.awayClub.name, homeScore: completed.homeScore, awayScore: completed.awayScore,
        attendance: completed.attendance, ticketRevenue: completed.ticketRevenue.toString(),
        homePenalties: completed.homePenalties, awayPenalties: completed.awayPenalties, winnerClubId: completed.winnerClubId,
        events: completed.events.map((event) => ({
          ...event, playerName: names.get(event.playerId) ?? "Player",
          relatedPlayerName: event.relatedPlayerId ? names.get(event.relatedPlayerId) ?? null : null,
        })),
      };
    }
    const runtime = await tx.matchRuntime.findUnique({ where: { matchId: match.id } });
    const runtimeState = runtime?.simulationState as unknown as {
      segment: MatchSegmentState;
      substitutions: { home: MatchSubstitutionState; away: MatchSubstitutionState };
    } | null;
    const isRuntimeSettlement = match.status === "IN_PROGRESS" && runtime?.status === "RUNNING"
      && runtime.currentMinute === 90 && runtimeState?.segment.currentMinute === 90;
    if (match.status !== "SCHEDULED" && !isRuntimeSettlement) throw new MatchServiceError("MATCH_NOT_SCHEDULED");
    if (match.simulationVersion !== 1) throw new MatchServiceError("UNSUPPORTED_SIMULATION_VERSION");
    const competition = match.competitionId
      ? await tx.competition.findUnique({ where: { id: match.competitionId }, select: { format: true, rules: true, cupLegs: true } })
      : null;
    if (match.scheduledAt > now) throw new MatchServiceError("MATCH_NOT_DUE", { scheduledAt: match.scheduledAt.toISOString() });
    const matchRules = validateMatchRules(match.rulesSnapshot ?? competition?.rules ?? defaultMatchRules(match.type));
    const kickoffSnapshot = runtime?.kickoffSnapshot as unknown as { home?: MatchSide; away?: MatchSide } | null;
    if (isRuntimeSettlement && (!kickoffSnapshot?.home || !kickoffSnapshot?.away)) {
      throw new MatchServiceError("MATCH_KICKOFF_SNAPSHOT_MISSING");
    }
    const homeSide = isRuntimeSettlement
      ? { ...kickoffSnapshot!.home!, ticketPrice: BigInt(String(kickoffSnapshot!.home!.ticketPrice)) }
      : toSide(home);
    const awaySide = isRuntimeSettlement
      ? { ...kickoffSnapshot!.away!, ticketPrice: BigInt(String(kickoffSnapshot!.away!.ticketPrice)) }
      : toSide(away);
    const homeForfeit = !isValidMatchSide(homeSide);
    const awayForfeit = !isValidMatchSide(awaySide);
    const forfeit = !isRuntimeSettlement && (homeForfeit || awayForfeit);
    const generated = forfeit
      ? {
          homeScore: homeForfeit ? 0 : 3,
          awayScore: awayForfeit ? 0 : 3,
          events: [],
          performances: [],
          attendance: 0,
          ticketRevenue: 0n,
          homeExpectedGoals: 0,
          awayExpectedGoals: 0,
        } as ReturnType<typeof simulateFootballMatch>
      : simulateFootballMatch({ seed: match.seed, home: homeSide, away: awaySide, rules: matchRules });
    const runtimeEvents = runtimeState?.segment.events;
    const runtimePlayerStats = new Map((runtimeState?.segment.playerStats ?? [])
      .map((item) => [item.playerId, item]));
    const result = isRuntimeSettlement && runtimeState
      ? {
          ...generated,
          homeScore: runtimeState.segment.home.score,
          awayScore: runtimeState.segment.away.score,
          events: runtimeEvents ?? [],
          homeExpectedGoals: runtimeState.segment.home.expectedGoals,
          awayExpectedGoals: runtimeState.segment.away.expectedGoals,
          performances: generated.performances.map((line) => {
            const stats = runtimePlayerStats.get(line.playerId);
            const goals = (runtimeEvents ?? []).filter((event) => event.type === "GOAL" && event.playerId === line.playerId).length;
            const assists = (runtimeEvents ?? []).filter((event) => event.type === "GOAL" && event.relatedPlayerId === line.playerId).length;
            const yellowCards = (runtimeEvents ?? []).filter((event) => event.type === "YELLOW_CARD" && event.playerId === line.playerId).length;
            const redCards = (runtimeEvents ?? []).filter((event) => event.type === "RED_CARD" && event.playerId === line.playerId).length;
            const injuries = (runtimeEvents ?? []).filter((event) => event.type === "INJURY" && event.playerId === line.playerId).length;
            const minutesPlayed = stats?.minutesPlayed ?? 0;
            const shots = Math.max(goals, stats?.shots ?? 0);
            const passes = stats?.passes ?? 0;
            const tackles = stats?.tackles ?? 0;
            const fitnessLoss = stats?.fitnessLoss ?? 0;
            const rating = Math.max(3, Math.min(10,
              6 + goals * 0.9 + assists * 0.45 + shots * 0.08 + tackles * 0.06
              + passes / 100 * 0.2 - yellowCards * 0.35 - redCards * 1.25 - injuries * 0.65));
            return {
              ...line, minutesPlayed, goals, assists, yellowCards, redCards, rating,
              shots, passes, tackles, fitnessLoss,
            };
          }),
        }
      : generated;
    const isTwoLegCup = competition?.format === "CUP" && competition.cupLegs === 2 && !!match.tieId;
    let aggregateHomeScore = result.homeScore;
    let aggregateAwayScore = result.awayScore;
    if (isTwoLegCup && match.leg === 1) {
      aggregateHomeScore = 0;
      aggregateAwayScore = 0;
    } else if (isTwoLegCup && match.leg === 2) {
      const firstLeg = await tx.footballMatch.findFirst({
        where: { competitionId: match.competitionId!, tieId: match.tieId!, leg: 1, status: "COMPLETED" },
        select: { homeClubId: true, awayClubId: true, homeScore: true, awayScore: true },
      });
      if (!firstLeg || firstLeg.homeScore === null || firstLeg.awayScore === null) {
        throw new MatchServiceError("CUP_FIRST_LEG_NOT_COMPLETED");
      }
      if (firstLeg.homeClubId !== match.awayClubId || firstLeg.awayClubId !== match.homeClubId) {
        throw new MatchServiceError("CUP_LEG_TEAM_ORDER_INVALID");
      }
      aggregateHomeScore += firstLeg.awayScore;
      aggregateAwayScore += firstLeg.homeScore;
    }
    const decidingTie = !isTwoLegCup || match.leg === 2;
    const penalties = !forfeit && decidingTie && matchRules.penaltiesOnDraw && aggregateHomeScore === aggregateAwayScore
      ? simulatePenaltyShootout({ seed: match.seed, home: homeSide, away: awaySide })
      : null;
    const winnerClubId = !decidingTie ? null
      : aggregateHomeScore > aggregateAwayScore ? home.id
        : aggregateAwayScore > aggregateHomeScore ? away.id
          : penalties ? (penalties.winner === "HOME" ? home.id : away.id) : null;
    const claimed = await tx.footballMatch.updateMany({
      where: { id: match.id, status: isRuntimeSettlement ? "IN_PROGRESS" : "SCHEDULED" },
      data: {
        status: "COMPLETED", startedAt: now, completedAt: now,
        homeScore: result.homeScore, awayScore: result.awayScore, homePenalties: penalties?.homePenalties ?? null,
        awayPenalties: penalties?.awayPenalties ?? null, winnerClubId, attendance: result.attendance,
        ticketRevenue: result.ticketRevenue, homeExpectedGoals: result.homeExpectedGoals,
        awayExpectedGoals: result.awayExpectedGoals,
      },
    });
    if (claimed.count !== 1) throw new MatchServiceError("MATCH_ALREADY_SIMULATED");
    const challengeForGroup = await tx.friendlyChallenge.findUnique({
      where: { matchId: match.id },
      select: { id: true, group: { select: { telegramId: true } } },
    });
    await tx.matchResultNotification.createMany({
      data: [
        { matchId: match.id, channel: "HOME", telegramChatId: home.owner.telegramId },
        { matchId: match.id, channel: "AWAY", telegramChatId: away.owner.telegramId },
        ...(challengeForGroup?.group?.telegramId
          ? [{ matchId: match.id, channel: "GROUP", telegramChatId: challengeForGroup.group.telegramId }]
          : []),
      ],
      skipDuplicates: true,
    });
    if (challengeForGroup) {
      const honorAwards = winnerClubId
        ? [{ clubId: winnerClubId, amount: 3n }]
        : [{ clubId: home.id, amount: 1n }, { clubId: away.id, amount: 1n }];
      for (const award of honorAwards) {
        const userId = award.clubId === home.id ? home.ownerId : away.ownerId;
        await tx.wallet.upsert({
          where: { userId_asset: { userId, asset: "HONOR" } },
          create: { userId, asset: "HONOR", balance: award.amount },
          update: { balance: { increment: award.amount }, version: { increment: 1 } },
        });
        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: `friendly-challenge-honor:${match.id}:${award.clubId}`,
            userId, asset: "HONOR", direction: "CREDIT", amount: award.amount,
            reason: "FRIENDLY_CHALLENGE_HONOR_REWARD",
            referenceType: "FRIENDLY_CHALLENGE", referenceId: challengeForGroup.id,
          },
        });
      }
    }
    if (isRuntimeSettlement && runtime) {
      const runtimeCompleted = await tx.matchRuntime.updateMany({
        where: { id: runtime.id, status: "RUNNING", currentMinute: 90 },
        data: { status: "COMPLETED", completedAt: now, nextActionAt: null, leaseOwner: null, leaseToken: null, leaseExpiresAt: null },
      });
      if (runtimeCompleted.count !== 1) throw new MatchServiceError("MATCH_RUNTIME_CONCURRENT_MODIFICATION");
    }
    if (result.events.length) {
      await tx.matchEvent.createMany({ data: result.events.map((event) => ({
        matchId: match.id, sequence: event.sequence, minute: event.minute, type: event.type,
        teamId: event.teamId, playerId: event.playerId, relatedPlayerId: event.relatedPlayerId ?? null, detail: event.detail,
      })) });
    }
    if (result.performances.length) {
      await tx.playerMatchPerformance.createMany({ data: result.performances.map((line) => ({
        matchId: match.id, playerId: line.playerId, clubId: line.clubId,
        minutesPlayed: line.minutesPlayed, goals: line.goals, assists: line.assists, shots: line.shots,
        passes: line.passes, tackles: line.tackles, yellowCards: line.yellowCards,
        redCards: line.redCards, rating: line.rating, fitnessLoss: line.fitnessLoss,
      })) });
    }
    const injuredIds = new Set(result.events.filter((event) => event.type === "INJURY").map((event) => event.playerId));
    const playerById = new Map(
      [...homeSide.players, ...(homeSide.bench ?? []), ...awaySide.players, ...(awaySide.bench ?? [])]
        .map((player) => [player.id, player] as const),
    );
    const injuredClubIds = new Set<string>();
    for (const line of result.performances) {
      const player = playerById.get(line.playerId);
      if (!player || line.minutesPlayed <= 0) continue;
      if (injuredIds.has(line.playerId)) {
        injuredClubIds.add(line.clubId);
        await tx.player.updateMany({
          where: { id: line.playerId, clubId: line.clubId, status: "ACTIVE" },
          data: {
            status: "INJURED", injuryUntil: new Date(now.getTime() + matchRules.injuryDurationDays * DAY_MS),
            lineupSlot: null, fitness: Math.max(0, player.fitness - 15 - line.fitnessLoss),
          },
        });
      } else {
        await tx.player.updateMany({
          where: { id: line.playerId, clubId: line.clubId, status: "ACTIVE" },
          data: { fitness: Math.max(0, player.fitness - line.fitnessLoss) },
        });
      }
    }
    // Existing suspensions are served by completing this fixture. New red cards
    // are then assigned a one-match suspension for the next eligible fixture.
    const previouslySuspended = forfeit ? [] : await tx.player.findMany({
      where: { clubId: { in: [home.id, away.id] }, suspensionMatchesRemaining: { gt: 0 } },
      select: { clubId: true },
    });
    if (!forfeit) {
      await tx.player.updateMany({
        where: { clubId: { in: [home.id, away.id] }, suspensionMatchesRemaining: { gt: 0 } },
        data: { suspensionMatchesRemaining: { decrement: 1 } },
      });
    }
    const redCardEvents = result.events.filter((event) => event.type === "RED_CARD");
    const sentOffPlayerIds = [...new Set(redCardEvents.map((event) => event.playerId))];
    if (sentOffPlayerIds.length && matchRules.redCardSuspensionMatches > 0) {
      await tx.player.updateMany({
        where: { id: { in: sentOffPlayerIds }, status: "ACTIVE" },
        data: { suspensionMatchesRemaining: matchRules.redCardSuspensionMatches },
      });
    }
    const yellowSuspendedClubIds = new Set<string>();
    if (match.competitionId && matchRules.yellowCardsToSuspend > 0 && matchRules.yellowCardSuspensionMatches > 0) {
      const yellowCounts = new Map<string, number>();
      for (const event of result.events.filter((item) => item.type === "YELLOW_CARD")) {
        yellowCounts.set(event.playerId, (yellowCounts.get(event.playerId) ?? 0) + 1);
      }
      for (const [playerId, currentCount] of yellowCounts) {
        if (sentOffPlayerIds.includes(playerId)) continue;
        const previousCount = await tx.matchEvent.count({
          where: { playerId, type: "YELLOW_CARD", matchId: { not: match.id }, match: { competitionId: match.competitionId } },
        });
        const threshold = matchRules.yellowCardsToSuspend;
        if (Math.floor((previousCount + currentCount) / threshold) > Math.floor(previousCount / threshold)) {
          await tx.player.updateMany({
            where: { id: playerId, status: "ACTIVE" },
            data: { suspensionMatchesRemaining: { increment: matchRules.yellowCardSuspensionMatches } },
          });
          const card = result.events.find((event) => event.type === "YELLOW_CARD" && event.playerId === playerId);
          if (card) yellowSuspendedClubIds.add(card.teamId);
        }
      }
    }
    const lineupChangedClubIds = new Set([
      ...injuredClubIds,
      ...previouslySuspended.map((player) => player.clubId),
      ...redCardEvents.map((event) => event.teamId),
      ...yellowSuspendedClubIds,
    ]);
    if (lineupChangedClubIds.size) {
      await tx.club.updateMany({
        where: { id: { in: [...lineupChangedClubIds] } },
        data: { lineupVersion: { increment: 1 } },
      });
    }
    const homeReward = winnerClubId ? (winnerClubId === home.id ? 250n : 100n) : 150n;
    const awayReward = winnerClubId ? (winnerClubId === away.id ? 250n : 100n) : 150n;
    await creditMatchCash(tx, home, result.ticketRevenue, `match:${match.id}:home-gate`,
      "MATCH_GATE_REVENUE", "MATCH_GATE_REVENUE", `Match gate receipts for attendance ${result.attendance}`, now);
    await creditMatchCash(tx, home, homeReward, `match:${match.id}:home-reward`,
      "MATCH_APPEARANCE_REWARD", "MATCH_REWARD", `Home match reward ${homeReward}`, now);
    await creditMatchCash(tx, away, awayReward, `match:${match.id}:away-reward`,
      "MATCH_APPEARANCE_REWARD", "MATCH_REWARD", `Away match reward ${awayReward}`, now);
    if (winnerClubId) {
      await tx.club.update({ where: { id: winnerClubId }, data: { reputation: { increment: 2 } } });
    } else {
      await tx.club.updateMany({ where: { id: { in: [home.id, away.id] } }, data: { reputation: { increment: 1 } } });
    }
    if (match.competitionId && competition?.format === "LEAGUE") {
      const homePoints = result.homeScore > result.awayScore ? 3 : result.homeScore === result.awayScore ? 1 : 0;
      const awayPoints = result.awayScore > result.homeScore ? 3 : result.homeScore === result.awayScore ? 1 : 0;
      await tx.competitionEntry.update({
        where: { competitionId_clubId: { competitionId: match.competitionId, clubId: home.id } },
        data: { played: { increment: 1 }, won: { increment: homePoints === 3 ? 1 : 0 }, drawn: { increment: homePoints === 1 ? 1 : 0 }, lost: { increment: homePoints === 0 ? 1 : 0 }, goalsFor: { increment: result.homeScore }, goalsAgainst: { increment: result.awayScore }, points: { increment: homePoints } },
      });
      await tx.competitionEntry.update({
        where: { competitionId_clubId: { competitionId: match.competitionId, clubId: away.id } },
        data: { played: { increment: 1 }, won: { increment: awayPoints === 3 ? 1 : 0 }, drawn: { increment: awayPoints === 1 ? 1 : 0 }, lost: { increment: awayPoints === 0 ? 1 : 0 }, goalsFor: { increment: result.awayScore }, goalsAgainst: { increment: result.homeScore }, points: { increment: awayPoints } },
      });
    }
    if (match.competitionId && competition?.format === "CUP") {
      const currentRound = await tx.footballMatch.findMany({
        where: { competitionId: match.competitionId, round: match.round },
        select: { id: true, winnerClubId: true, status: true },
        orderBy: { id: "asc" },
      });
      if (currentRound.length > 0 && currentRound.every((fixture) => fixture.status === "COMPLETED" && fixture.winnerClubId)) {
        const winners = currentRound.map((fixture) => fixture.winnerClubId!).filter(Boolean);
        if (winners.length === 1) {
          await tx.competition.updateMany({
            where: { id: match.competitionId, status: "ACTIVE" },
            data: { status: "COMPLETED", completedAt: now },
          });
        } else {
          const nextRound = (match.round ?? 1) + 1;
          const nextFixtures = [];
          for (let index = 0; index < winners.length; index += 2) {
            const homeClubId = winners[index]!;
            const awayClubId = winners[index + 1]!;
            const idempotencyKey = "cup:" + match.competitionId + ":r" + nextRound + ":" + homeClubId + ":" + awayClubId;
            nextFixtures.push({
              idempotencyKey, type: "CUP" as const, competitionId: match.competitionId,
              round: nextRound, homeClubId, awayClubId,
              scheduledAt: new Date(now.getTime() + 3 * DAY_MS), seed: idempotencyKey,
            });
          }
          await tx.footballMatch.createMany({ data: nextFixtures, skipDuplicates: true });
        }
      }
    }
    const final = await tx.footballMatch.findUniqueOrThrow({ where: { id: match.id }, include: {
      homeClub: { select: { name: true } }, awayClub: { select: { name: true } },
      events: { orderBy: { sequence: "asc" } },
    } });
    return {
      replayed: false, matchId: final.id, competitionId: final.competitionId, homeClub: final.homeClub.name, awayClub: final.awayClub.name,
      homeScore: final.homeScore, awayScore: final.awayScore, homePenalties: final.homePenalties,
      awayPenalties: final.awayPenalties, winnerClubId: final.winnerClubId, attendance: final.attendance,
      ticketRevenue: final.ticketRevenue.toString(), events: final.events.map((event) => ({
        ...event,
        playerName: [...home.players, ...away.players].find((player) => player.id === event.playerId)?.firstName
          + " " + ([...home.players, ...away.players].find((player) => player.id === event.playerId)?.lastName ?? ""),
        relatedPlayerName: event.relatedPlayerId
          ? [...home.players, ...away.players].find((player) => player.id === event.relatedPlayerId)?.firstName
            + " " + ([...home.players, ...away.players].find((player) => player.id === event.relatedPlayerId)?.lastName ?? "")
          : null,
      })),
    };
  });
  if (settlement.competitionId) {
    const competition = await prisma.competition.findUnique({
      where: { id: settlement.competitionId }, select: { format: true },
    });
    if (competition?.format === "LEAGUE") {
      const remaining = await prisma.footballMatch.count({
        where: { competitionId: settlement.competitionId, status: "SCHEDULED" },
      });
      if (remaining === 0) {
        await prisma.competition.updateMany({
          where: { id: settlement.competitionId, status: "ACTIVE" },
          data: { status: "COMPLETED", completedAt: now },
        });
        const pyramid = await import("./league-pyramid-service.js");
        await pyramid.processPyramidLeagueCompletion(settlement.competitionId, now);
      }
    } else if (competition?.format === "CUP") {
      const fixture = await prisma.footballMatch.findUnique({
        where: { id: settlement.matchId }, select: { round: true },
      });
      if (fixture?.round !== null && fixture?.round !== undefined) {
        await advanceCupRound(settlement.competitionId, fixture.round, now);
      }
    }
  }
  return settlement;
}

type RuntimeState = {
  segment: MatchSegmentState;
  substitutions: { home: MatchSubstitutionState; away: MatchSubstitutionState };
  substitutionErrors: string[];
};
function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;
}
function restoreRuntimeState(value: Prisma.JsonValue | null): RuntimeState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = value as unknown as RuntimeState;
  for (const side of [parsed.segment.home.side, parsed.segment.away.side]) {
    side.ticketPrice = BigInt(String(side.ticketPrice));
  }
  return parsed;
}
function substitutionState(side: MatchSide): MatchSubstitutionState {
  return {
    onPitch: side.players.map(({ id, position }) => ({ id, position })),
    bench: (side.bench ?? []).map(({ id, position }) => ({ id, position })),
    substitutionsUsed: 0, inPlayWindowsUsed: 0, substitutedOutIds: [], sentOffIds: [], usedCheckpointIds: [],
  };
}
function applyRuntimeInstruction(
  side: MatchSide,
  current: MatchSubstitutionState,
  instruction: MatchTacticalInstruction,
  checkpoint: "HALF_TIME" | "MINUTE_60" | "MINUTE_75",
  checkpointId: string,
  source: "MANAGER" | "PREMATCH_PLAN" | "AI",
  rules: MatchRules,
): { side: MatchSide; substitutions: MatchSubstitutionState; events: MatchSegmentState["events"]; error: string | null } {
  let nextSide = side;
  let nextSubstitutions = current;
  let events: MatchSegmentState["events"] = [];
  let error: string | null = null;
  if (instruction.substitutions?.length) {
    try {
      const applied = applyMatchSubstitutions({
        state: current,
        changes: instruction.substitutions,
        checkpoint,
        checkpointId,
        source,
        rules,
      });
      const players = new Map([...(side.players), ...(side.bench ?? [])].map((player) => [player.id, player]));
      nextSide = {
        ...side,
        players: applied.state.onPitch.map((player) => players.get(player.id)!).filter(Boolean),
        bench: applied.state.bench.map((player) => players.get(player.id)!).filter(Boolean),
      };
      nextSubstitutions = applied.state;
      const names = new Map([...side.players, ...(side.bench ?? [])].map((player) => [player.id, player.name]));
      const minute = checkpoint === "HALF_TIME" ? 45 : checkpoint === "MINUTE_60" ? 60 : 75;
      events = applied.substitutions.map((change) => ({
        minute, type: "SUBSTITUTION" as const, teamId: side.clubId,
        playerId: change.outgoingPlayerId, relatedPlayerId: change.incomingPlayerId,
        detail: "Substitution: " + (names.get(change.outgoingPlayerId) ?? "Player")
          + " replaced by " + (names.get(change.incomingPlayerId) ?? "Player") + ".",
        sequence: 0,
      }));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "INVALID_SUBSTITUTION_PACKAGE";
    }
  }
  return {
    side: {
      ...nextSide,
      formation: instruction.formation ?? nextSide.formation,
      tactics: {
        mentality: instruction.mentality ?? nextSide.tactics.mentality,
        pressing: instruction.pressing ?? nextSide.tactics.pressing,
        tempo: instruction.tempo ?? nextSide.tactics.tempo,
        passingStyle: instruction.passingStyle ?? nextSide.tactics.passingStyle,
      },
    },
    substitutions: nextSubstitutions,
    events,
    error,
  };
}

/** Create durable kickoff snapshots for due fixtures that predate runtime creation. */
export async function enqueueDueMatchRuntimes(now = new Date(), limit = 50) {
  const fixtures = await prisma.footballMatch.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now }, runtime: { is: null } },
    include: { homeClub: { include: matchClubInclude }, awayClub: { include: matchClubInclude } },
    orderBy: { scheduledAt: "asc" }, take: limit,
  });
  let created = 0;
  for (const fixture of fixtures) {
    try {
      const home = toSide(fixture.homeClub);
      const away = toSide(fixture.awayClub);
      if (!isValidMatchSide(home) || !isValidMatchSide(away)) {
        await simulateScheduledMatch(fixture.homeClub.ownerId, fixture.id, now);
        continue;
      }
      const result = await prisma.matchRuntime.createMany({
        data: [{
          matchId: fixture.id, status: "QUEUED", currentMinute: 0,
          nextActionAt: fixture.scheduledAt,
          kickoffSnapshot: jsonSafe({ home, away }),
          fallbackPlan: jsonSafe({
            // Freeze each club's independently configured fallback plan at kickoff.
            home: fixture.homeClub.matchFallbackPlan
              ? fixture.homeClub.matchFallbackPlan
              : { formation: home.formation, ...home.tactics },
            away: fixture.awayClub.matchFallbackPlan
              ? fixture.awayClub.matchFallbackPlan
              : { formation: away.formation, ...away.tactics },
          }),
        }],
        skipDuplicates: true,
      });
      created += result.count;
    } catch {
      // A malformed squad must not block other due fixtures; retry on the next worker tick.
    }
  }
  return created;
}

async function processClaimedMatchRuntime(
  runtimeId: string,
  now: Date,
): Promise<"WAITING" | "ADVANCED" | "SETTLED"> {
  const runtime = await prisma.matchRuntime.findUnique({
    where: { id: runtimeId },
    include: {
      match: {
        include: {
          homeClub: { include: matchClubInclude },
          awayClub: { include: matchClubInclude },
        },
      },
    },
  });
  if (!runtime || runtime.match.status === "COMPLETED" || runtime.status === "COMPLETED") return "SETTLED";

  let state = restoreRuntimeState(runtime.simulationState);
  if (!state) {
    const snapshot = runtime.kickoffSnapshot as unknown as { home: MatchSide; away: MatchSide } | null;
    if (!snapshot?.home || !snapshot?.away) throw new MatchServiceError("MATCH_KICKOFF_SNAPSHOT_MISSING");
    snapshot.home.ticketPrice = BigInt(String(snapshot.home.ticketPrice));
    snapshot.away.ticketPrice = BigInt(String(snapshot.away.ticketPrice));
    const initial: MatchSegmentState = {
      currentMinute: 0, nextSequence: 1,
      home: { side: snapshot.home, score: 0, expectedGoals: 0 },
      away: { side: snapshot.away, score: 0, expectedGoals: 0 },
      events: [],
    };
    const initialSubstitutions = {
      home: substitutionState(snapshot.home),
      away: substitutionState(snapshot.away),
    };
    const first = advanceMatchSegment({
      seed: runtime.match.seed, state: initial, toMinute: 45,
      homeSubstitutions: initialSubstitutions.home,
      awaySubstitutions: initialSubstitutions.away,
      rules: rulesForMatch(runtime.match),
    });
    const checkpointAt = new Date(now.getTime() + 60_000);
    state = {
      segment: first.state,
      substitutions: { home: first.homeSubstitutions, away: first.awaySubstitutions },
      substitutionErrors: first.substitutionErrors,
    };
    await prisma.$transaction(async (tx) => {
      const runtimeUpdated = await tx.matchRuntime.updateMany({
        where: { id: runtime.id, stateVersion: runtime.stateVersion, leaseToken: runtime.leaseToken },
        data: {
          status: "AWAITING_CHECKPOINT", currentMinute: 45, stateVersion: { increment: 1 },
          simulationState: jsonSafe(state), startedAt: runtime.startedAt ?? now,
          nextActionAt: new Date(now.getTime() + 5_000), lastError: null,
        },
      });
      if (runtimeUpdated.count !== 1) throw new MatchServiceError("MATCH_RUNTIME_CONCURRENT_MODIFICATION");
      const matchUpdated = await tx.footballMatch.updateMany({
        where: { id: runtime.matchId, status: "SCHEDULED" },
        data: { status: "IN_PROGRESS", startedAt: runtime.match.startedAt ?? now },
      });
      if (matchUpdated.count !== 1) throw new MatchServiceError("MATCH_NOT_SCHEDULED");
      await tx.matchTacticalCheckpoint.createMany({
        data: [{
          matchId: runtime.matchId, checkpointKey: "minute-45", kind: "HALF_TIME", minute: 45,
          openedAt: now, decisionDeadlineAt: checkpointAt, nextSegmentAt: checkpointAt,
        }],
        skipDuplicates: true,
      });
    });
    return "ADVANCED";
  }

  if (state.segment.currentMinute === 90) {
    await simulateScheduledMatch(runtime.match.homeClub.ownerId, runtime.matchId, now);
    return "SETTLED";
  }

  const checkpoint = await prisma.matchTacticalCheckpoint.findFirst({
    where: { matchId: runtime.matchId, status: "OPEN" },
    orderBy: { minute: "asc" },
  });
  if (!checkpoint) throw new MatchServiceError("MATCH_OPEN_CHECKPOINT_MISSING");
  const decisions = await prisma.matchTacticalDecision.findMany({
    where: { checkpointId: checkpoint.id },
    orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
  });
  const bothResponded = [runtime.match.homeClubId, runtime.match.awayClubId]
    .every((clubId) => decisions.some((decision) => decision.clubId === clubId
      && decision.submittedAt >= checkpoint.openedAt
      && decision.submittedAt < checkpoint.decisionDeadlineAt));
  if (!bothResponded && now < checkpoint.nextSegmentAt) return "WAITING";

  const kind = checkpoint.kind;
  const checkpointName = kind === "HALF_TIME" ? "HALF_TIME" : kind === "MINUTE_60" ? "MINUTE_60" : "MINUTE_75";
  const fallback = runtime.fallbackPlan as unknown as { home: MatchTacticalInstruction | null; away: MatchTacticalInstruction | null } | null;
  const resolution = resolveMatchCheckpoint<MatchTacticalInstruction>({
    window: {
      checkpointId: checkpoint.id, checkpoint: checkpointName,
      openedAt: checkpoint.openedAt, decisionDeadlineAt: checkpoint.decisionDeadlineAt,
      nextSegmentAt: checkpoint.nextSegmentAt,
      homeClubId: runtime.match.homeClubId, awayClubId: runtime.match.awayClubId,
    },
    now,
    decisions: decisions.map((decision) => ({
      id: decision.id, clubId: decision.clubId, submittedAt: decision.submittedAt,
      instruction: decision.instruction as unknown as MatchTacticalInstruction,
    })),
    fallback: fallback ?? { home: null, away: null },
    aiDefaults: { home: {}, away: {} },
  });
  const matchRules = rulesForMatch(runtime.match);
  const homeApplied = applyRuntimeInstruction(
    state.segment.home.side, state.substitutions.home, resolution.home.instruction,
    checkpointName, checkpoint.checkpointKey, resolution.home.source, matchRules,
  );
  const awayApplied = applyRuntimeInstruction(
    state.segment.away.side, state.substitutions.away, resolution.away.instruction,
    checkpointName, checkpoint.checkpointKey, resolution.away.source, matchRules,
  );
  const nextMinute = checkpoint.minute === 45 ? 60 : checkpoint.minute === 60 ? 75 : 90;
  const substitutionEvents = [...homeApplied.events, ...awayApplied.events].map((event, index) => ({
    ...event, sequence: state.segment.nextSequence + index,
  }));
  const advanced = advanceMatchSegment({
    seed: runtime.match.seed,
    state: {
      ...state.segment,
      nextSequence: state.segment.nextSequence + substitutionEvents.length,
      events: [...state.segment.events, ...substitutionEvents],
      home: { ...state.segment.home, side: homeApplied.side },
      away: { ...state.segment.away, side: awayApplied.side },
    },
    toMinute: nextMinute,
    homeSubstitutions: homeApplied.substitutions,
    awaySubstitutions: awayApplied.substitutions,
    rules: matchRules,
  });
  const nextState: RuntimeState = {
    segment: advanced.state,
    substitutions: { home: advanced.homeSubstitutions, away: advanced.awaySubstitutions },
    substitutionErrors: [
      ...state.substitutionErrors,
      ...advanced.substitutionErrors,
      ...(homeApplied.error ? ["HOME:" + homeApplied.error] : []),
      ...(awayApplied.error ? ["AWAY:" + awayApplied.error] : []),
    ],
  };
  const isFullTime = nextMinute === 90;
  await prisma.$transaction(async (tx) => {
    const checkpointUpdated = await tx.matchTacticalCheckpoint.updateMany({
      where: { id: checkpoint.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: now, resolution: jsonSafe(resolution) },
    });
    if (checkpointUpdated.count !== 1) throw new MatchServiceError("MATCH_CHECKPOINT_ALREADY_RESOLVED");
    const runtimeUpdated = await tx.matchRuntime.updateMany({
      where: { id: runtime.id, stateVersion: runtime.stateVersion, leaseToken: runtime.leaseToken },
      data: {
        status: "RUNNING", currentMinute: nextMinute, stateVersion: { increment: 1 },
        simulationState: jsonSafe(nextState), nextActionAt: isFullTime ? now : new Date(now.getTime() + 5_000),
        lastError: null,
      },
    });
    if (runtimeUpdated.count !== 1) throw new MatchServiceError("MATCH_RUNTIME_CONCURRENT_MODIFICATION");
    if (!isFullTime) {
      const nextKind = nextMinute === 60 ? "MINUTE_60" : "MINUTE_75";
      const nextAt = new Date(now.getTime() + 60_000);
      await tx.matchTacticalCheckpoint.createMany({
        data: [{
          matchId: runtime.matchId, checkpointKey: "minute-" + nextMinute,
          kind: nextKind, minute: nextMinute, openedAt: now,
          decisionDeadlineAt: nextAt, nextSegmentAt: nextAt,
        }],
        skipDuplicates: true,
      });
    }
  });
  if (isFullTime) {
    await simulateScheduledMatch(runtime.match.homeClub.ownerId, runtime.matchId, now);
    return "SETTLED";
  }
  return "ADVANCED";
}

/** Durable worker tick. Checkpoints are polled every five seconds so two early replies resume immediately. */
export async function processDueMatchRuntimes(
  workerId = "match-worker",
  now = new Date(),
  limit = 10,
): Promise<{ enqueued: number; claimed: number; advanced: number; waiting: number; settled: number; failed: number }> {
  const enqueued = await enqueueDueMatchRuntimes(now, Math.max(limit, 10));
  const claimed = await claimDueMatchRuntimes(workerId, now, 30_000, limit);
  const totals = { enqueued, claimed: claimed.length, advanced: 0, waiting: 0, settled: 0, failed: 0 };
  for (const item of claimed) {
    try {
      const outcome = await processClaimedMatchRuntime(item.runtime.id, now);
      if (outcome === "ADVANCED") totals.advanced++;
      else if (outcome === "WAITING") totals.waiting++;
      else totals.settled++;
      if (outcome !== "SETTLED") {
        const nextActionAt = outcome === "WAITING" ? new Date(now.getTime() + 5_000) : new Date(now.getTime() + 5_000);
        await releaseMatchRuntimeLease(item.runtime.id, item.lease.token, nextActionAt, null);
      }
    } catch (error) {
      totals.failed++;
      await releaseMatchRuntimeLease(
        item.runtime.id, item.lease.token, new Date(now.getTime() + 10_000),
        error instanceof Error ? error.message.slice(0, 500) : "MATCH_RUNTIME_WORKER_ERROR",
      );
    }
  }
  return totals;
}
