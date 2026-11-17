import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";

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

test("event tournament registration and HONOR prize settlement are atomic and idempotent", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const previousSecret = process.env.BOT_API_SECRET;
  const previousAdmins = process.env.GAME_ADMIN_TELEGRAM_IDS;
  const secret = "event-tournament-integration-test-secret";
  const adminTelegramId = String(710_000_000 + Math.floor(Math.random() * 80_000_000));
  const playerTelegramId = String(810_000_000 + Math.floor(Math.random() * 80_000_000));
  const admin = await prisma.user.create({ data: { telegramId: adminTelegramId, displayName: "Tournament Admin" } });
  const player = await prisma.user.create({ data: { telegramId: playerTelegramId, displayName: "Tournament Player" } });
  const club = await prisma.club.create({ data: { ownerId: player.id, name: "Tournament FC", slug: "tournament-" + randomUUID().slice(0, 12) } });
  process.env.BOT_API_SECRET = secret;
  process.env.GAME_ADMIN_TELEGRAM_IDS = adminTelegramId;
  const app = buildApp({ logger: false });
  await app.ready();
  let tournamentId: string | undefined;
  t.after(async () => {
    if (tournamentId) {
      await prisma.adminAuditLog.deleteMany({ where: { targetType: "event-tournament", targetId: tournamentId } });
      await prisma.eventTournament.deleteMany({ where: { id: tournamentId } });
    }
    await prisma.ledgerTransaction.deleteMany({ where: { userId: player.id } });
    await prisma.wallet.deleteMany({ where: { userId: player.id } });
    await prisma.club.deleteMany({ where: { id: club.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, player.id] } } });
    await app.close();
    if (previousSecret === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previousSecret;
    if (previousAdmins === undefined) delete process.env.GAME_ADMIN_TELEGRAM_IDS;
    else process.env.GAME_ADMIN_TELEGRAM_IDS = previousAdmins;
  });
  const adminHeaders = { "x-football-bot-secret": secret, "x-telegram-user-id": adminTelegramId };
  const playerHeaders = { "x-football-bot-secret": secret, "x-telegram-user-id": playerTelegramId };
  const now = Date.now();
  const created = await app.inject({
    method: "POST", url: "/v1/admin/event-tournaments", headers: adminHeaders,
    payload: {
      idempotencyKey: "create-" + randomUUID(),
      title: "Honor Cup",
      description: "Integration test event tournament",
      maxParticipants: 8,
      registrationEndsAt: new Date(now + 86_400_000).toISOString(),
      startsAt: new Date(now + 2 * 86_400_000).toISOString(),
      prizes: [{ placement: 1, type: "HONOR", amount: "100" }],
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  tournamentId = created.json().tournament.id;
  const joined = await app.inject({ method: "POST", url: "/v1/event-tournaments/" + tournamentId + "/join", headers: playerHeaders, payload: {} });
  assert.equal(joined.statusCode, 200, joined.body);
  const participants = await app.inject({ method: "GET", url: "/v1/admin/event-tournaments/" + tournamentId + "/participants", headers: adminHeaders });
  assert.equal(participants.statusCode, 200, participants.body);
  const participantId = participants.json().participants[0].id;
  const finalized = await app.inject({
    method: "POST", url: "/v1/admin/event-tournaments/" + tournamentId + "/finalize", headers: adminHeaders,
    payload: { idempotencyKey: "finalize-" + randomUUID(), results: [{ participantId, placement: 1, score: 10 }] },
  });
  assert.equal(finalized.statusCode, 200, finalized.body);
  assert.equal(finalized.json().awards, 1);
  const honorWallet = await prisma.wallet.findUnique({ where: { userId_asset: { userId: player.id, asset: "HONOR" } } });
  assert.equal(honorWallet?.balance, 100n);
  const ledger = await prisma.ledgerTransaction.findFirst({ where: { userId: player.id, reason: "EVENT_TOURNAMENT_PRIZE", referenceId: tournamentId } });
  assert.ok(ledger);
});
