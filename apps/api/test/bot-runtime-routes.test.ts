import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("Bot identity verification is protected by the shared Bot API secret", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "runtime-identity-test-secret";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  });
  const response = await app.inject({
    method: "POST", url: "/v1/bot/verify-identity",
    payload: { telegramBotId: 123456 },
  });
  assert.equal(response.statusCode, 401);
});

test("Bot polling runtime lease is exclusive, renewable, and releasable", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const { prisma } = await import("../src/db.js");
  const previousSecret = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "runtime-lease-test-secret-with-32-chars";
  const app = buildApp();
  await app.ready();
  const leaseId = "telegram-bot-polling";
  const instanceA = "11111111-1111-4111-8111-111111111111";
  const instanceB = "22222222-2222-4222-8222-222222222222";
  try {
    await prisma.botRuntimeLease.deleteMany({ where: { id: leaseId } });
    const headers = { "x-football-bot-secret": process.env.BOT_API_SECRET! };
    const call = (instanceId: string, action: string) => app.inject({
      method: "POST",
      url: "/v1/bot/runtime/lease",
      headers,
      payload: { instanceId, action },
    });

    const acquired = await call(instanceA, "acquire");
    assert.equal(acquired.statusCode, 200);
    assert.equal(acquired.json().acquired, true);

    const rejected = await call(instanceB, "acquire");
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.json().acquired, false);

    const renewed = await call(instanceA, "heartbeat");
    assert.equal(renewed.json().acquired, true);

    const released = await call(instanceA, "release");
    assert.equal(released.json().released, true);

    const takeover = await call(instanceB, "acquire");
    assert.equal(takeover.json().acquired, true);
    await call(instanceB, "release");
  } finally {
    await prisma.botRuntimeLease.deleteMany({ where: { id: leaseId } });
    await app.close();
    if (previousSecret === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previousSecret;
  }
});
