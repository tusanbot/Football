import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const context = { waitUntil() {} };

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

test("game routes stay closed until server-side configuration exists", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/v1/me"), {}, context);
  assert.equal(response.status, 503);
  const body = await response.json() as { status: string; missing: string[] };
  assert.equal(body.status, "not_ready");
  assert.ok(body.missing.length >= 5);
});
