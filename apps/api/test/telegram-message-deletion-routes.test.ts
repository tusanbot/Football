import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";

test("durable group deletion queue requires the shared Bot secret", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "deletion-queue-test-secret";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  });

  const responses = await Promise.all([
    app.inject({ method: "POST", url: "/v1/bot/group-message-deletions", payload: {} }),
    app.inject({ method: "POST", url: "/v1/bot/group-message-deletions/claim", payload: { limit: 1 } }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [401, 401]);
});

test("durable group deletion queue validates chat and message identity", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "deletion-queue-test-secret";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/bot/group-message-deletions",
    headers: { "x-football-bot-secret": "deletion-queue-test-secret" },
    payload: { telegramChatId: "not-a-chat", messageId: 0, deleteAt: "invalid" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "INVALID_GROUP_MESSAGE_DELETION");
});

test("durable group deletion jobs survive scheduling and are claimed and acknowledged", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "deletion-queue-test-secret";
  const app = buildApp();
  await app.ready();
  const telegramChatId = BigInt(-1_000_000_000_000 - Math.floor(Math.random() * 100_000_000));
  const messageId = Math.floor(Math.random() * 1_000_000) + 1;
  const headers = { "x-football-bot-secret": "deletion-queue-test-secret" };
  const base = "/v1/bot/group-message-deletions";
  try {
    const scheduled = await app.inject({
      method: "POST", url: base, headers,
      payload: {
        telegramChatId: telegramChatId.toString(),
        messageId,
        deleteAt: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    assert.equal(scheduled.statusCode, 202);
    const jobId = scheduled.json().job.id as string;
    const stored = await prisma.telegramMessageDeletion.findUnique({ where: { id: jobId } });
    assert.ok(stored);
    assert.equal(stored.telegramChatId, telegramChatId);

    const claimed = await app.inject({
      method: "POST", url: base + "/claim", headers, payload: { limit: 25 },
    });
    assert.equal(claimed.statusCode, 200);
    const job = claimed.json().jobs.find((item: { id: string }) => item.id === jobId) as
      { id: string; claimToken: string } | undefined;
    assert.ok(job, "scheduled job should be claimable after its deadline");

    const completed = await app.inject({
      method: "POST", url: base + "/" + jobId + "/complete", headers,
      payload: { claimToken: job.claimToken },
    });
    assert.equal(completed.statusCode, 200);
    const finalState = await prisma.telegramMessageDeletion.findUnique({ where: { id: jobId } });
    assert.equal(finalState?.status, "DELETED");
  } finally {
    await prisma.telegramMessageDeletion.deleteMany({ where: { telegramChatId, messageId } });
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  }
});

test("expired worker leases can be reclaimed and failed jobs back off", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "deletion-queue-test-secret";
  const app = buildApp();
  await app.ready();
  const telegramChatId = BigInt(-1_000_000_000_000 - Math.floor(Math.random() * 100_000_000));
  const messageId = Math.floor(Math.random() * 1_000_000) + 1;
  const headers = { "x-football-bot-secret": "deletion-queue-test-secret" };
  const base = "/v1/bot/group-message-deletions";
  try {
    const scheduled = await app.inject({
      method: "POST", url: base, headers,
      payload: { telegramChatId: telegramChatId.toString(), messageId, deleteAt: new Date(Date.now() - 1_000).toISOString() },
    });
    assert.equal(scheduled.statusCode, 202);
    const jobId = scheduled.json().job.id as string;
    const claimed = await app.inject({ method: "POST", url: base + "/claim", headers, payload: { limit: 25 } });
    const first = claimed.json().jobs.find((item: { id: string }) => item.id === jobId);
    assert.ok(first);

    await prisma.telegramMessageDeletion.update({
      where: { id: jobId }, data: { lockedUntil: new Date(Date.now() - 1_000) },
    });
    const reclaimed = await app.inject({ method: "POST", url: base + "/claim", headers, payload: { limit: 25 } });
    const second = reclaimed.json().jobs.find((item: { id: string }) => item.id === jobId);
    assert.ok(second);
    assert.notEqual(second.claimToken, first.claimToken);

    const failed = await app.inject({
      method: "POST", url: base + "/" + jobId + "/fail", headers,
      payload: { claimToken: second.claimToken, error: "temporary Telegram API error" },
    });
    assert.equal(failed.statusCode, 200);
    assert.equal(failed.json().rescheduled, true);
    const state = await prisma.telegramMessageDeletion.findUnique({ where: { id: jobId } });
    assert.equal(state?.status, "PENDING");
    assert.ok(state && state.availableAt.getTime() > Date.now());
  } finally {
    await prisma.telegramMessageDeletion.deleteMany({ where: { telegramChatId, messageId } });
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  }
});
