import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { createTelegramSessionToken } from "../src/auth/telegram-session.js";
import { simulateScheduledMatch } from "../src/game/match-service.js";

test("event tournament player and admin routes require authenticated Telegram users", async (t) => {
  const app = buildApp({ logger: false });
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

test("event tournament auto-starts at capacity and settles HONOR prizes from simulated league results", async (t) => {
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
  const app = buildApp({ logger: false });
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
  for (const [index, fixture] of fixtures.entries()) {
    const owner = players.find((player) => player.clubId === fixture.homeClubId || player.clubId === fixture.awayClubId)!;
    await simulateScheduledMatch(owner.userId, fixture.id, new Date(fixture.scheduledAt.getTime() + 90_000));
    if (index === 0) {
      const stillActive = await prisma.competition.findUniqueOrThrow({ where: { id: competitionId }, select: { status: true } });
      assert.equal(stillActive.status, "ACTIVE");
    }
  }
  const completed = await prisma.eventTournament.findUniqueOrThrow({ where: { id: tournamentId }, include: { participants: true } });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.participants.length, 4);
  assert.deepEqual(completed.participants.map((participant) => participant.placement).sort(), [1, 2, 3, 4]);
  const winner = completed.participants.find((participant) => participant.placement === 1)!;
  const honorWallet = await prisma.wallet.findUnique({ where: { userId_asset: { userId: winner.userId, asset: "HONOR" } } });
  assert.equal(honorWallet?.balance, 100n);
  const ledger = await prisma.ledgerTransaction.findFirst({ where: { userId: winner.userId, reason: "EVENT_TOURNAMENT_PRIZE", referenceId: tournamentId } });
  assert.ok(ledger);
  const manual = await app.inject({ method: "POST", url: "/v1/admin/event-tournaments/" + tournamentId + "/finalize", headers: adminHeaders, payload: { idempotencyKey: "manual-" + randomUUID(), results: [] } });
  assert.equal(manual.statusCode, 409);
  assert.equal(manual.json().error, "TOURNAMENT_RESULTS_AUTOMATIC");
});
