import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";

test("match checkpoint notification claim and acknowledgement require the system Bot secret", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "test-match-notification-secret";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  });
  const [claim, ack] = await Promise.all([
    app.inject({ method: "POST", url: "/v1/bot/match-checkpoints/claim", payload: { limit: 5 } }),
    app.inject({ method: "POST", url: "/v1/bot/match-checkpoints/ack", payload: {
      checkpointId: "missing", side: "HOME", delivered: true,
    } }),
  ]);
  assert.equal(claim.statusCode, 401);
  assert.equal(ack.statusCode, 401);
});

test("checkpoint notifications retry after failed delivery and acknowledge success once", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "test-match-notification-secret";
  const app = buildApp();
  await app.ready();
  const suffix = randomUUID().replaceAll("-", "");
  let homeClubId = "";
  let awayClubId = "";
  let matchId = "";
  try {
    const home = await prisma.user.create({
      data: {
        telegramId: "notify-home-" + suffix,
        displayName: "Notification Home",
        club: { create: { name: "Notification Home", slug: "notify-home-" + suffix } },
      },
      include: { club: true },
    });
    const away = await prisma.user.create({
      data: {
        telegramId: "notify-away-" + suffix,
        displayName: "Notification Away",
        club: { create: { name: "Notification Away", slug: "notify-away-" + suffix } },
      },
      include: { club: true },
    });
    homeClubId = home.club!.id;
    awayClubId = away.club!.id;
    const now = new Date();
    const match = await prisma.footballMatch.create({
      data: {
        idempotencyKey: "notify-match-" + suffix,
        type: "FRIENDLY",
        homeClubId,
        awayClubId,
        scheduledAt: now,
        seed: "notify-seed-" + suffix,
      },
    });
    matchId = match.id;
    const checkpoint = await prisma.matchTacticalCheckpoint.create({
      data: {
        matchId,
        checkpointKey: "minute-45",
        kind: "HALF_TIME",
        minute: 45,
        openedAt: now,
        decisionDeadlineAt: new Date(now.getTime() + 60_000),
        nextSegmentAt: new Date(now.getTime() + 60_000),
      },
    });
    const headers = { "x-football-bot-secret": "test-match-notification-secret" };
    const claim = await app.inject({
      method: "POST", url: "/v1/bot/match-checkpoints/claim", headers, payload: { limit: 10 },
    });
    assert.equal(claim.statusCode, 200);
    const first = claim.json() as { notifications: Array<{ checkpointId:string; side:string; attempt:number }> };
    assert.equal(first.notifications.length, 2);
    assert.deepEqual(first.notifications.map((item) => item.attempt).sort(), [1, 1]);
    const failed = await app.inject({
      method: "POST", url: "/v1/bot/match-checkpoints/ack", headers,
      payload: { checkpointId: checkpoint.id, side: "HOME", delivered: false, error: "Telegram blocked recipient" },
    });
    assert.equal(failed.statusCode, 200);
    const afterFailure = await prisma.matchTacticalCheckpoint.findUniqueOrThrow({ where: { id: checkpoint.id } });
    assert.equal(afterFailure.homeBotNotifiedAt, null);
    assert.equal(afterFailure.homeBotNotificationLastError, "Telegram blocked recipient");
    await prisma.matchTacticalCheckpoint.update({
      where: { id: checkpoint.id },
      data: { homeBotNotificationClaimedAt: new Date(Date.now() - 31_000) },
    });
    const retry = await app.inject({
      method: "POST", url: "/v1/bot/match-checkpoints/claim", headers, payload: { limit: 10 },
    });
    assert.equal(retry.statusCode, 200);
    const retried = retry.json() as { notifications: Array<{ checkpointId:string; side:string; attempt:number }> };
    assert.deepEqual(retried.notifications.map((item) => ({ side:item.side, attempt:item.attempt })), [
      { side: "HOME", attempt: 2 },
    ]);
    for (const side of ["HOME", "AWAY"] as const) {
      const acknowledged = await app.inject({
        method: "POST", url: "/v1/bot/match-checkpoints/ack", headers,
        payload: { checkpointId: checkpoint.id, side, delivered: true },
      });
      assert.equal(acknowledged.statusCode, 200);
    }
    const completed = await prisma.matchTacticalCheckpoint.findUniqueOrThrow({ where: { id: checkpoint.id } });
    assert.ok(completed.homeBotNotifiedAt);
    assert.ok(completed.awayBotNotifiedAt);
    assert.equal(completed.homeBotNotificationAttempts, 2);
    assert.equal(completed.awayBotNotificationAttempts, 1);
    assert.equal(completed.homeBotNotificationLastError, null);
    const finalClaim = await app.inject({
      method: "POST", url: "/v1/bot/match-checkpoints/claim", headers, payload: { limit: 10 },
    });
    assert.deepEqual(finalClaim.json(), { notifications: [] });
  } finally {
    if (matchId) await prisma.footballMatch.deleteMany({ where: { id: matchId } });
    const ids = [homeClubId, awayClubId].filter(Boolean);
    if (ids.length) await prisma.club.deleteMany({ where: { id: { in: ids } } });
    const telegramIds = ["notify-home-" + suffix, "notify-away-" + suffix];
    await prisma.user.deleteMany({ where: { telegramId: { in: telegramIds } } });
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  }
});
