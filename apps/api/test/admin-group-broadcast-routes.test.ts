import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("admin group broadcast worker endpoints reject requests without the Bot secret", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "test-admin-group-broadcast-secret";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  });
  const responses = await Promise.all([
    app.inject({ method: "POST", url: "/v1/bot/admin-group-broadcasts/claim", payload: { limit: 10 } }),
    app.inject({ method: "POST", url: "/v1/bot/admin-group-broadcasts/missing/complete", payload: { claimToken: "00000000-0000-4000-8000-000000000000" } }),
    app.inject({ method: "POST", url: "/v1/bot/admin-group-broadcasts/missing/fail", payload: { claimToken: "00000000-0000-4000-8000-000000000000", error: "failure" } }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [401, 401, 401]);
});

test("readiness reports missing production configuration without exposing secrets", async (t) => {
  const keys = ["DATABASE_URL", "TELEGRAM_BOT_TOKEN", "BOT_API_SECRET", "CORS_ORIGIN"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const response = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 503);
  const body = response.json() as { status: string; missing: string[] };
  assert.equal(body.status, "not_ready");
  assert.deepEqual(body.missing, ["DATABASE_URL", "TELEGRAM_BOT_TOKEN", "BOT_API_SECRET", "CORS_ORIGIN"]);
  assert.equal(JSON.stringify(body).includes("secret"), false);
});
