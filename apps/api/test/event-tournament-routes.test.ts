import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { createTelegramSessionToken } from "../src/auth/telegram-session.js";

test("event tournament player and admin routes require authenticated Telegram users", async (t) => {
  const app = buildApp({ logger: false, actionRateLimitPort: { async consume() { return true; } } });
  await app.ready();
  t.after(async () => app.close());

  const playerList = await app.inject({ method: "GET", url: "/v1/event-tournaments" });
  assert.equal(playerList.statusCode, 401);
  assert.deepEqual(playerList.json(), { error: "UNAUTHENTICATED" });

  const join = await app.inject({ method: "POST", url: "/v1/event-tournaments/example/join", payload: {} });
  assert.equal(join.statusCode, 401);
  assert.deepEqual(join.json(), { error: "UNAUTHENTICATED" });

  const adminList = await app.inject({ method: "GET", url: "/v1/admin/event-tournaments" });
  assert.equal(adminList.statusCode, 401);
  assert.deepEqual(adminList.json(), { error: "UNAUTHENTICATED" });

  const create = await app.inject({ method: "POST", url: "/v1/admin/event-tournaments", payload: {} });
  assert.equal(create.statusCode, 401);
  assert.deepEqual(create.json(), { error: "UNAUTHENTICATED" });
});

async function makeTournamentClub(suffix: string, index: number) {
  const positions = ["GK","RB","CB","CB","LB","CDM","CM","CAM","RW","ST","LW","GK","CB","RB","LB","CM","ST","RW"] as const;
  const user = await prisma.user.create({
    data: {
      telegramId: String(820_000_000 + Math.floor(Math.random() * 70_000_000) + index),
      displayName: "Tournament Player " + index,
      club: { create: { name: "Tournament Club " + index, slug: "event-tournament-" + suffix.slice(0, 10) + "-" + index } },
      wallets: { create: [{ asset: "CASH", balance: 1000n }, { asset: "GOLD", balance: 10n }] },
    }, include: { club: true },
  });
  const clubId = user.club!.id;
  await prisma.player.createMany({ data: positions.map((position, slot) => ({
    clubId, firstName: "Player" + slot, lastName: "Club" + index, nationality: "IR",
    age: 22 + (slot % 8), position, overall: 58 + index * 2, potential: 78 + index * 2,
    attributes: { pace: 62, shooting: 62, passing: 62, dribbling: 62, defending: 62, physical: 62, goalkeeping: position === "GK" ? 72 : 25 },
    wage: 100n, contractDays: 300, morale: 75, fitness: 95, lineupSlot: slot < 11 ? slot + 1 : null,
  })) });
  return { userId: user.id, telegramId: user.telegramId, clubId };
}

test("event tournament auto-starts at capacity and creates a valid round-robin fixture schedule", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const previousSecret = process.env.BOT_API_SECRET;
  const previousAdmins = process.env.GAME_ADMIN_TELEGRAM_IDS;
  const secret = "event-tournament-integration-test-secret";
  const adminTelegramId = String(710_000_000 + Math.floor(Math.random() * 80_000_000));
  const admin = await prisma.user.create({ data: { telegramId: adminTelegramId, displayName: "Tournament Admin" } });
  const suffix = randomUUID().replaceAll("-", "");
  const players = await Promise.all(Array.from({ length: 4 }, (_, index) => makeTournamentClub(suffix, index)));
  process.env.BOT_API_SECRET = secret;
  process.env.GAME_ADMIN_TELEGRAM_IDS = adminTelegramId;
  const app = buildApp({
    logger: false,
    actionRateLimitPort: { async consume() { return true; } },
    eventTournamentReadPort: {
      async join(input) {
        return prisma.$transaction(async (tx) => {
          const existing = await tx.eventTournamentParticipant.findUnique({
            where: { tournamentId_userId: { tournamentId: input.tournamentId, userId: (await tx.user.findUniqueOrThrow({ where: { telegramId: input.telegramUserId }, select: { id: true } })).id } },
          });
          if (existing) return { participantId: existing.id, replayed: true, autoStarted: false };
          const user = await tx.user.findUniqueOrThrow({ where: { telegramId: input.telegramUserId }, select: { id: true } });
          const tournament = await tx.eventTournament.findUniqueOrThrow({ where: { id: input.tournamentId } });
          const club = await tx.club.findUniqueOrThrow({ where: { ownerId: user.id }, select: { id: true } });
          const now = new Date(input.now);
          const count = await tx.eventTournamentParticipant.count({ where: { tournamentId: tournament.id } });
          const participant = await tx.eventTournamentParticipant.create({ data: { tournamentId: tournament.id, userId: user.id, clubId: club.id } });
          const participantCount = count + 1;
          if (participantCount < tournament.maxParticipants) return {
            participantId: participant.id, replayed: false, autoStarted: false,
            participantCount, requiredParticipants: tournament.maxParticipants,
          };
          const participants = await tx.eventTournamentParticipant.findMany({
            where: { tournamentId: tournament.id }, orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
          });
          const slots = participants.map((item) => item.clubId);
          const rounds = slots.length - 1;
          const kickoffAt = new Date(now.getTime() + 86_400_000);
          const competition = await tx.competition.create({ data: {
            idempotencyKey: "event-tournament-competition:" + tournament.id, name: tournament.title,
            season: now.getUTCFullYear(), format: "LEAGUE", status: "ACTIVE",
            maxTeams: participants.length, createdByClubId: participants[0]!.clubId,
            startsAt: kickoffAt, rules: { penaltiesOnDraw: false },
            entries: { create: participants.map((item) => ({ clubId: item.clubId })) },
          } });
          const fixtures = [];
          for (let round = 0; round < rounds; round++) {
            for (let index = 0; index < slots.length / 2; index++) {
              const first = slots[index]!, second = slots[slots.length - 1 - index]!;
              const swap = (round + index) % 2 === 1;
              const homeClubId = swap ? second : first, awayClubId = swap ? first : second;
              const idempotencyKey = "event-tournament:" + tournament.id + ":r" + (round + 1) + ":" + homeClubId + ":" + awayClubId;
              fixtures.push({ idempotencyKey, type: "LEAGUE" as const, competitionId: competition.id,
                round: round + 1, homeClubId, awayClubId,
                scheduledAt: new Date(kickoffAt.getTime() + round * 86_400_000), seed: idempotencyKey });
            }
            const fixed = slots[0]!, rotating = slots.slice(1);
            rotating.unshift(rotating.pop()!);
            slots.splice(0, slots.length, fixed, ...rotating);
          }
          await tx.footballMatch.createMany({ data: fixtures });
          await tx.eventTournament.update({ where: { id: tournament.id }, data: {
            status: "ACTIVE", competitionId: competition.id, startsAt: kickoffAt,
          } });
          return { participantId: participant.id, replayed: false, autoStarted: true,
            participantCount, fixturesCreated: fixtures.length, rounds, startsAt: kickoffAt.toISOString(),
            competitionId: competition.id };
        });
      },
      async create(input) {
        const tournament = await prisma.eventTournament.create({
          data: {
            idempotencyKey: "event-tournament-create:" + input.idempotencyKey,
            title: input.title, description: input.description,
            entryFeeAsset: input.entryFeeAsset as "CASH" | "GOLD" | "HONOR" | null,
            entryFeeAmount: BigInt(input.entryFeeAmount), maxParticipants: input.maxParticipants,
            registrationEndsAt: new Date(input.registrationEndsAt), startsAt: new Date(input.startsAt),
            endsAt: input.endsAt ? new Date(input.endsAt) : null, createdByTelegramId: input.telegramUserId,
            prizes: { create: input.prizes.map((prize) => ({
              placement: prize.placement, type: prize.type as "CASH" | "GOLD" | "HONOR" | "STORE_ITEM" | "SPECIAL_PLAYER",
              amount: BigInt(prize.amount), itemKey: prize.itemKey, specialPlayerId: prize.specialPlayerId,
            })) },
          },
        });
        await prisma.adminAuditLog.create({ data: {
          actorTelegramId: input.telegramUserId, action: "create-event-tournament", targetType: "event-tournament",
          targetId: tournament.id, idempotencyKey: "event-tournament-audit:" + input.idempotencyKey,
          metadata: { title: input.title, prizeCount: input.prizes.length },
        } });
        return { tournament: { id: tournament.id, title: tournament.title, status: tournament.status }, replayed: false };
      },
      async listForUser() { return []; },
      async listForAdmin() { return []; },
      async listParticipants() { return []; },
    },
  });
  await app.ready();
  let tournamentId: string | undefined;
  let competitionId: string | undefined;
  t.after(async () => {
    if (tournamentId) {
      const tournament = await prisma.eventTournament.findUnique({ where: { id: tournamentId }, select: { competitionId: true } });
      const linkedCompetitionId = tournament?.competitionId ?? competitionId;
      await prisma.leagueNotice.deleteMany({ where: { OR: [{ referenceId: tournamentId }, ...(linkedCompetitionId ? [{ referenceId: linkedCompetitionId }] : []), { dedupeKey: { startsWith: "event-tournament-result:" + tournamentId + ":" } }] } });
      if (linkedCompetitionId) {
        await prisma.footballMatch.deleteMany({ where: { competitionId: linkedCompetitionId } });
        await prisma.competition.deleteMany({ where: { id: linkedCompetitionId } });
      }
      await prisma.adminAuditLog.deleteMany({ where: { targetType: "event-tournament", targetId: tournamentId } });
      await prisma.eventTournament.deleteMany({ where: { id: tournamentId } });
    }
    const userIds = [admin.id, ...players.map((player) => player.userId)];
    await prisma.ledgerTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.club.deleteMany({ where: { id: { in: players.map((player) => player.clubId) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    if (previousSecret === undefined) delete process.env.BOT_API_SECRET; else process.env.BOT_API_SECRET = previousSecret;
    if (previousAdmins === undefined) delete process.env.GAME_ADMIN_TELEGRAM_IDS; else process.env.GAME_ADMIN_TELEGRAM_IDS = previousAdmins;
  });
  const adminHeaders = { authorization: "Bearer " + createTelegramSessionToken(adminTelegramId, secret).token };
  const now = Date.now();
  const created = await app.inject({
    method: "POST", url: "/v1/admin/event-tournaments", headers: adminHeaders,
    payload: {
      idempotencyKey: "create-" + randomUUID(), title: "Honor Cup",
      description: "Automatic event tournament integration test", maxParticipants: 4,
      registrationEndsAt: new Date(now + 86_400_000).toISOString(), startsAt: new Date(now + 2 * 86_400_000).toISOString(),
      prizes: [{ placement: 1, type: "HONOR", amount: "100" }],
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  tournamentId = created.json().tournament.id;
  let lastJoin: { autoStarted?: boolean; fixturesCreated?: number; rounds?: number; startsAt?: string } | undefined;
  for (let index = 0; index < players.length; index++) {
    const player = players[index]!;
    const headers = { authorization: "Bearer " + createTelegramSessionToken(player.telegramId, secret).token };
    const joined = await app.inject({ method: "POST", url: "/v1/event-tournaments/" + tournamentId + "/join", headers, payload: {} });
    assert.equal(joined.statusCode, 200, joined.body);
    if (index === players.length - 1) lastJoin = joined.json();
  }
  assert.equal(lastJoin?.autoStarted, true);
  assert.equal(lastJoin?.fixturesCreated, 6);
  assert.equal(lastJoin?.rounds, 3);
  const tournament = await prisma.eventTournament.findUniqueOrThrow({ where: { id: tournamentId } });
  assert.equal(tournament.status, "ACTIVE");
  competitionId = tournament.competitionId ?? undefined;
  assert.ok(competitionId);
  const fixtures = await prisma.footballMatch.findMany({ where: { competitionId }, orderBy: [{ round: "asc" }, { scheduledAt: "asc" }] });
  assert.equal(fixtures.length, 6);
  assert.equal(new Set(fixtures.map((fixture) => fixture.round)).size, 3);
  const opponentPairs = fixtures.map((fixture) => [fixture.homeClubId, fixture.awayClubId].sort().join(":"));
  assert.equal(new Set(opponentPairs).size, 6);
  for (const round of [1, 2, 3]) {
    const roundFixtures = fixtures.filter((fixture) => fixture.round === round);
    assert.equal(roundFixtures.length, 2);
    assert.equal(new Set(roundFixtures.flatMap((fixture) => [fixture.homeClubId, fixture.awayClubId])).size, 4);
    assert.equal(new Set(roundFixtures.map((fixture) => fixture.scheduledAt.getTime())).size, 1);
  }
  assert.equal(fixtures[0]!.scheduledAt.getTime() - Date.now() >= 23 * 60 * 60_000, true);
  assert.equal(fixtures.every((fixture) => fixture.homeClubId !== fixture.awayClubId), true);
});
