import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { TelegramMessageDeletionPort, TelegramMessageDeletionJob } from "../src/telegram-message-deletion-routes.js";

function fixture() {
  const jobs = new Map<string, TelegramMessageDeletionJob & { deleteAt: string; status: string; attempts: number }>();
  const port: TelegramMessageDeletionPort = {
    async schedule(input) {
      const existing = [...jobs.values()].find(x => x.telegramChatId === input.telegramChatId && x.messageId === input.messageId);
      const job = { id: existing?.id ?? randomUUID(), telegramChatId: input.telegramChatId, messageId: input.messageId,
        claimToken: "", deleteAt: input.deleteAt, status: "PENDING", attempts: 0 };
      jobs.set(job.id, job);
      return { id: job.id, status: job.status, deleteAt: job.deleteAt };
    },
    async claim(limit) {
      const due = [...jobs.values()].filter(x => x.status === "PENDING" && Date.parse(x.deleteAt) <= Date.now()).slice(0, limit);
      return due.map(x => { x.status = "PROCESSING"; x.attempts++; x.claimToken = randomUUID(); return {
        id: x.id, telegramChatId: x.telegramChatId, messageId: x.messageId, claimToken: x.claimToken,
      }; });
    },
    async complete(id, token) {
      const job = jobs.get(id);
      if (!job || job.status !== "PROCESSING" || job.claimToken !== token) return false;
      job.status = "DELETED"; job.claimToken = ""; return true;
    },
    async fail(id, token, error) {
      const job = jobs.get(id);
      if (!job || job.status !== "PROCESSING" || job.claimToken !== token) return null;
      job.status = job.attempts >= 8 ? "FAILED" : "PENDING"; job.claimToken = "";
      return { rescheduled: job.status === "PENDING", failed: job.status === "FAILED", attempts: job.attempts };
    },
  };
  return { port, jobs };
}
test("deletion queue requires shared Bot secret", async t => {
  const previous = process.env.BOT_API_SECRET; process.env.BOT_API_SECRET = "deletion-queue-test-secret";
  const app = buildApp({ logger: false, telegramMessageDeletionPort: fixture().port }); await app.ready();
  t.after(async () => { await app.close(); if (previous === undefined) delete process.env.BOT_API_SECRET; else process.env.BOT_API_SECRET = previous; });
  const responses = await Promise.all([
    app.inject({ method: "POST", url: "/v1/bot/group-message-deletions", payload: {} }),
    app.inject({ method: "POST", url: "/v1/bot/group-message-deletions/claim", payload: { limit: 1 } }),
  ]);
  assert.deepEqual(responses.map(x => x.statusCode), [401, 401]);
});
test("deletion queue validates Telegram chat and message identity", async t => {
  const previous = process.env.BOT_API_SECRET; process.env.BOT_API_SECRET = "deletion-queue-test-secret";
  const app = buildApp({ logger: false, telegramMessageDeletionPort: fixture().port }); await app.ready();
  t.after(async () => { await app.close(); if (previous === undefined) delete process.env.BOT_API_SECRET; else process.env.BOT_API_SECRET = previous; });
  const response = await app.inject({ method: "POST", url: "/v1/bot/group-message-deletions",
    headers: { "x-football-bot-secret": "deletion-queue-test-secret" },
    payload: { telegramChatId: "not-a-chat", messageId: 0, deleteAt: "invalid" } });
  assert.equal(response.statusCode, 400); assert.equal(response.json().error, "INVALID_GROUP_MESSAGE_DELETION");
});
test("Supabase-backed deletion queue schedules, claims, and completes durable jobs", async t => {
  const previous = process.env.BOT_API_SECRET; process.env.BOT_API_SECRET = "deletion-queue-test-secret";
  const { port, jobs } = fixture(); const app = buildApp({ logger: false, telegramMessageDeletionPort: port }); await app.ready();
  const headers = { "x-football-bot-secret": "deletion-queue-test-secret" }; const base = "/v1/bot/group-message-deletions";
  t.after(async () => { await app.close(); if (previous === undefined) delete process.env.BOT_API_SECRET; else process.env.BOT_API_SECRET = previous; });
  const scheduled = await app.inject({ method: "POST", url: base, headers,
    payload: { telegramChatId: "-100123456789", messageId: 42, deleteAt: new Date(Date.now()-1000).toISOString() } });
  assert.equal(scheduled.statusCode, 202); const id = scheduled.json().job.id as string; assert.ok(jobs.has(id));
  const claimed = await app.inject({ method: "POST", url: base + "/claim", headers, payload: { limit: 25 } });
  const job = claimed.json().jobs[0] as TelegramMessageDeletionJob; assert.ok(job);
  const completed = await app.inject({ method: "POST", url: base + "/" + id + "/complete", headers, payload: { claimToken: job.claimToken } });
  assert.equal(completed.statusCode, 200); assert.equal(jobs.get(id)?.status, "DELETED");
});
test("deletion queue rejects stale claims and applies retry/failure policy", async t => {
  const previous = process.env.BOT_API_SECRET; process.env.BOT_API_SECRET = "deletion-queue-test-secret";
  const { port, jobs } = fixture(); const app = buildApp({ logger: false, telegramMessageDeletionPort: port }); await app.ready();
  const headers = { "x-football-bot-secret": "deletion-queue-test-secret" }; const base = "/v1/bot/group-message-deletions";
  t.after(async () => { await app.close(); if (previous === undefined) delete process.env.BOT_API_SECRET; else process.env.BOT_API_SECRET = previous; });
  const scheduled = await app.inject({ method: "POST", url: base, headers,
    payload: { telegramChatId: "-100123456789", messageId: 43, deleteAt: new Date(Date.now()-1000).toISOString() } });
  const id = scheduled.json().job.id as string;
  const claimed = await app.inject({ method: "POST", url: base + "/claim", headers, payload: { limit: 25 } });
  const job = claimed.json().jobs[0] as TelegramMessageDeletionJob;
  const failed = await app.inject({ method: "POST", url: base + "/" + id + "/fail", headers,
    payload: { claimToken: job.claimToken, error: "temporary Telegram API error" } });
  assert.equal(failed.statusCode, 200); assert.equal(failed.json().rescheduled, true);
  assert.equal(jobs.get(id)?.status, "PENDING");
  const stale = await app.inject({ method: "POST", url: base + "/" + id + "/complete", headers, payload: { claimToken: job.claimToken } });
  assert.equal(stale.statusCode, 409);
});
