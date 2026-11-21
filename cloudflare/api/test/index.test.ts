import test from "node:test";
import assert from "node:assert/strict";
import worker, { MatchCoordinator } from "../src/index.js";

const pending: Promise<unknown>[] = [];
const context = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } };
const configuredEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/football_empire",
  TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz0123456789",
  BOT_API_SECRET: "test-secret-".padEnd(40, "x"),
  CORS_ORIGIN: "https://web.example.test",
  GAME_ADMIN_TELEGRAM_IDS: "123456789",
  ENVIRONMENT: "development",
};

test("match coordinator schedules its first durable alarm", async () => {
  let alarmAt = 0;
  const coordinator = new MatchCoordinator({
    storage: {
      async setAlarm(value: number) { alarmAt = value; },
      async deleteAlarm() { alarmAt = 0; },
    },
  }, {});
  const response = await coordinator.fetch(new Request("https://coordinator.internal/ensure", { method: "POST" }));
  assert.equal(response.status, 200);
  assert.ok(alarmAt > Date.now());
});

test("health endpoint works without database configuration", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/health"), {}, context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "football-empire-cloudflare-api",
    mode: "fastify-prisma-runtime",
  });
});

test("readiness fails closed and reports missing runtime configuration", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/ready"), {}, context);
  assert.equal(response.status, 503);
  const body = await response.json() as { status: string; missing: string[] };
  assert.equal(body.status, "not_ready");
  assert.ok(body.missing.includes("HYPERDRIVE or DATABASE_URL"));
  assert.ok(body.missing.includes("TELEGRAM_BOT_TOKEN"));
  assert.ok(body.missing.includes("BOT_API_SECRET"));
  assert.ok(body.missing.includes("CORS_ORIGIN"));
  assert.ok(body.missing.includes("GAME_ADMIN_TELEGRAM_IDS"));
});

test("the Worker adapts Fetch requests to the existing Fastify application", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/not-a-route"), configuredEnv, context);
  assert.equal(response.status, 404);
  await Promise.all(pending.splice(0));
});

test("readiness executes a real PostgreSQL query through the Worker Prisma adapter", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/ready"), configuredEnv, context);
  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; service: string };
  assert.equal(body.status, "ready");
  assert.equal(body.service, "football-empire-api");
  await Promise.all(pending.splice(0));
});

test("Telegram auth route uses the shared Fastify route validation", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/v1/auth/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: "" }),
  }), configuredEnv, context);
  assert.equal(response.status, 400);
  await Promise.all(pending.splice(0));
});
