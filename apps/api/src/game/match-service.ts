import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { simulateFootballMatch, type MatchSide, type MatchTactics } from "@football/domain";
import { prisma } from "../db.js";

const DAY_MS = 86_400_000;
export class MatchServiceError extends Error {
  constructor(public readonly code: string, public readonly details?: Record<string, string>) {
    super(code); this.name = "MatchServiceError";
  }
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
      morale: true, fitness: true, attributes: true,
    },
  },
};
type LoadedClub = Prisma.ClubGetPayload<{ include: typeof matchClubInclude }>;
function toSide(club: LoadedClub): MatchSide {
  const starters = club.players.filter((player) => player.lineupSlot !== null)
    .sort((a, b) => (a.lineupSlot ?? 99) - (b.lineupSlot ?? 99));
  const bench = club.players.filter((player) => player.lineupSlot === null)
    .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
  const selected = [...starters];
  if (!selected.some((player) => player.position === "GK")) {
    const reserveKeeper = bench.find((player) => player.position === "GK");
    if (reserveKeeper) selected.push(reserveKeeper);
  }
  for (const player of bench) {
    if (selected.length >= 11) break;
    if (!selected.some((item) => item.id === player.id)) selected.push(player);
  }
  if (selected.length < 11) throw new MatchServiceError("BOTH_CLUBS_NEED_VALID_LINEUPS");
  return {
    clubId: club.id, clubName: club.name, formation: club.formation, tactics: asTactics(club),
    stadiumCapacity: Math.max(1000, Math.round(1000 * Math.pow(1.35, club.stadiumLevel - 1))),
    ticketPrice: club.ticketPrice, reputation: club.reputation,
    coachMedicalSkill: club.coach?.medicalSkill ?? 0,
    players: selected.slice(0, 11).map((player) => ({
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
export async function listMatchOpponents(userId: string) {
  const own = await getOwnedClub(userId);
  const clubs = await prisma.club.findMany({
    where: { id: { not: own.id }, players: { some: { lineupSlot: { not: null }, status: "ACTIVE" } } },
    include: { players: { where: { status: "ACTIVE" }, select: { id: true, position: true } } },
    orderBy: [{ reputation: "desc" }, { level: "desc" }], take: 50,
  });
  return clubs.filter((club) => club.players.length >= 11 && club.players.some((player) => player.position === "GK")).map((club) => ({
    id: club.id, name: club.name, level: club.level, reputation: club.reputation,
  }));
}
export async function createFriendlyMatch(userId: string, opponentClubId: string, idempotencyKey: string, scheduledAt = new Date(Date.now() + 5 * 60_000)) {
  keyValid(idempotencyKey);
  const own = await getOwnedClub(userId);
  if (own.id === opponentClubId) throw new MatchServiceError("MATCH_TEAMS_MUST_DIFFER");
  const [home, away] = await Promise.all([
    prisma.club.findUnique({ where: { id: own.id }, include: matchClubInclude }),
    prisma.club.findUnique({ where: { id: opponentClubId }, include: matchClubInclude }),
  ]);
  if (!home || !away) throw new MatchServiceError("OPPONENT_NOT_FOUND");
  if (home.players.length < 11 || away.players.length < 11) throw new MatchServiceError("BOTH_CLUBS_NEED_VALID_LINEUPS");
  toSide(home); toSide(away);
  if (scheduledAt.getTime() < Date.now() - 60_000 || scheduledAt.getTime() > Date.now() + 30 * DAY_MS) {
    throw new MatchServiceError("INVALID_MATCH_SCHEDULE");
  }
  const previous = await prisma.footballMatch.findUnique({ where: { idempotencyKey } });
  if (previous) {
    if (previous.homeClubId !== own.id || previous.awayClubId !== opponentClubId || previous.type !== "FRIENDLY") {
      throw new MatchServiceError("IDEMPOTENCY_CONFLICT");
    }
    return { match: previous, replayed: true };
  }
  const overlap = await prisma.footballMatch.findFirst({
    where: {
      status: "SCHEDULED", scheduledAt: { gte: new Date(scheduledAt.getTime() - 2 * 60 * 60_000), lte: new Date(scheduledAt.getTime() + 2 * 60 * 60_000) },
      OR: [{ homeClubId: { in: [own.id, opponentClubId] } }, { awayClubId: { in: [own.id, opponentClubId] } }],
    },
  });
  if (overlap) throw new MatchServiceError("CLUB_ALREADY_HAS_MATCH_IN_WINDOW");
  const match = await prisma.footballMatch.create({
    data: {
      idempotencyKey, type: "FRIENDLY", homeClubId: own.id, awayClubId: opponentClubId,
      scheduledAt, seed: idempotencyKey + ":" + randomUUID(),
    },
  });
  return { match, replayed: false };
}
export async function createLeague(userId: string, name: string, maxTeams: number, idempotencyKey: string) {
  keyValid(idempotencyKey);
  const club = await getOwnedClub(userId);
  const existing = await prisma.competition.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.createdByClubId !== club.id || existing.name !== name || existing.maxTeams !== maxTeams) {
      throw new MatchServiceError("IDEMPOTENCY_CONFLICT");
    }
    return { competition: existing, replayed: true };
  }
  const competition = await prisma.competition.create({
    data: {
      idempotencyKey, name, season: new Date().getUTCFullYear(), maxTeams, createdByClubId: club.id,
      entries: { create: { clubId: club.id } },
    },
  });
  return { competition, replayed: false };
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
    const teams = competition.entries.map((entry) => entry.clubId);
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
    id: competition.id, name: competition.name, season: competition.season,
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
    competition: { id: competition.id, name: competition.name, season: competition.season, status: competition.status, startsAt: competition.startsAt?.toISOString() ?? null },
    standings: competition.entries.map((entry, index) => ({
      position: index + 1, clubId: entry.clubId, clubName: entry.club.name, played: entry.played,
      won: entry.won, drawn: entry.drawn, lost: entry.lost, goalsFor: entry.goalsFor,
      goalsAgainst: entry.goalsAgainst, goalDifference: entry.goalsFor - entry.goalsAgainst, points: entry.points,
    })),
    matches: competition.matches.map((match) => ({
      id: match.id, round: match.round, scheduledAt: match.scheduledAt.toISOString(), status: match.status,
      homeClub: match.homeClub, awayClub: match.awayClub, homeScore: match.homeScore, awayScore: match.awayScore,
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
      }, orderBy: { scheduledAt: "desc" }, take: 50,
    }),
    prisma.competition.findMany({
      where: { entries: { some: { clubId: club.id } } },
      select: { id: true, name: true, season: true, status: true }, orderBy: { createdAt: "desc" }, take: 20,
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
      id: match.id, type: match.type, status: match.status, scheduledAt: match.scheduledAt.toISOString(),
      homeClub: match.homeClub, awayClub: match.awayClub, homeScore: match.homeScore, awayScore: match.awayScore,
      attendance: match.attendance, ticketRevenue: match.ticketRevenue.toString(), round: match.round,
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
export async function simulateScheduledMatch(userId: string, matchId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
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
        replayed: true, matchId: completed.id, homeClub: completed.homeClub.name,
        awayClub: completed.awayClub.name, homeScore: completed.homeScore, awayScore: completed.awayScore,
        attendance: completed.attendance, ticketRevenue: completed.ticketRevenue.toString(),
        events: completed.events.map((event) => ({
          ...event, playerName: names.get(event.playerId) ?? "Player",
          relatedPlayerName: event.relatedPlayerId ? names.get(event.relatedPlayerId) ?? null : null,
        })),
      };
    }
    if (match.status !== "SCHEDULED") throw new MatchServiceError("MATCH_NOT_SCHEDULED");
    if (match.scheduledAt > now) throw new MatchServiceError("MATCH_NOT_DUE", { scheduledAt: match.scheduledAt.toISOString() });
    const result = simulateFootballMatch({ seed: match.seed, home: toSide(home), away: toSide(away) });
    const claimed = await tx.footballMatch.updateMany({
      where: { id: match.id, status: "SCHEDULED" },
      data: {
        status: "COMPLETED", startedAt: now, completedAt: now,
        homeScore: result.homeScore, awayScore: result.awayScore, attendance: result.attendance,
        ticketRevenue: result.ticketRevenue, homeExpectedGoals: result.homeExpectedGoals,
        awayExpectedGoals: result.awayExpectedGoals,
      },
    });
    if (claimed.count !== 1) throw new MatchServiceError("MATCH_ALREADY_SIMULATED");
    await tx.matchEvent.createMany({ data: result.events.map((event) => ({
      matchId: match.id, sequence: event.sequence, minute: event.minute, type: event.type,
      teamId: event.teamId, playerId: event.playerId, relatedPlayerId: event.relatedPlayerId ?? null, detail: event.detail,
    })) });
    await tx.playerMatchPerformance.createMany({ data: result.performances.map((line) => ({
      matchId: match.id, playerId: line.playerId, clubId: line.clubId,
      minutesPlayed: line.minutesPlayed, goals: line.goals, assists: line.assists, shots: line.shots,
      passes: line.passes, tackles: line.tackles, yellowCards: line.yellowCards,
      redCards: line.redCards, rating: line.rating, fitnessLoss: line.fitnessLoss,
    })) });
    const injuredIds = new Set(result.events.filter((event) => event.type === "INJURY").map((event) => event.playerId));
    const playerById = new Map([...home.players, ...away.players].map((player) => [player.id, player]));
    const injuredClubIds = new Set<string>();
    for (const line of result.performances) {
      const player = playerById.get(line.playerId);
      if (!player) continue;
      if (injuredIds.has(line.playerId)) {
        injuredClubIds.add(line.clubId);
        await tx.player.updateMany({
          where: { id: line.playerId, clubId: line.clubId, status: "ACTIVE" },
          data: {
            status: "INJURED", injuryUntil: new Date(now.getTime() + 5 * DAY_MS),
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
    if (injuredClubIds.size > 0) {
      await tx.club.updateMany({ where: { id: { in: [...injuredClubIds] } }, data: { lineupVersion: { increment: 1 } } });
    }
    const homeReward = result.homeScore > result.awayScore ? 250n : result.homeScore === result.awayScore ? 150n : 100n;
    const awayReward = result.awayScore > result.homeScore ? 250n : result.homeScore === result.awayScore ? 150n : 100n;
    await creditMatchCash(tx, home, result.ticketRevenue, `match:${match.id}:home-gate`,
      "MATCH_GATE_REVENUE", "MATCH_GATE_REVENUE", `Match gate receipts for attendance ${result.attendance}`, now);
    await creditMatchCash(tx, home, homeReward, `match:${match.id}:home-reward`,
      "MATCH_APPEARANCE_REWARD", "MATCH_REWARD", `Home match reward ${homeReward}`, now);
    await creditMatchCash(tx, away, awayReward, `match:${match.id}:away-reward`,
      "MATCH_APPEARANCE_REWARD", "MATCH_REWARD", `Away match reward ${awayReward}`, now);
    if (result.homeScore !== result.awayScore) {
      await tx.club.update({ where: { id: result.homeScore > result.awayScore ? home.id : away.id }, data: { reputation: { increment: 2 } } });
    } else {
      await tx.club.updateMany({ where: { id: { in: [home.id, away.id] } }, data: { reputation: { increment: 1 } } });
    }
    if (match.competitionId) {
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
      const remaining = await tx.footballMatch.count({ where: { competitionId: match.competitionId, status: "SCHEDULED", id: { not: match.id } } });
      if (remaining === 0) await tx.competition.update({ where: { id: match.competitionId }, data: { status: "COMPLETED", completedAt: now } });
    }
    const final = await tx.footballMatch.findUniqueOrThrow({ where: { id: match.id }, include: {
      homeClub: { select: { name: true } }, awayClub: { select: { name: true } },
      events: { orderBy: { sequence: "asc" } },
    } });
    return {
      replayed: false, matchId: final.id, homeClub: final.homeClub.name, awayClub: final.awayClub.name,
      homeScore: final.homeScore, awayScore: final.awayScore, attendance: final.attendance,
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
}
