import test from "node:test";
import assert from "node:assert/strict";
import worker, { MatchCoordinator } from "../src/index.js";

const pending: Promise<unknown>[] = [];
const context = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } };
const configuredEnv = {
  SUPABASE_URL: "https://example-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough-for-tests",
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
    mode: "supabase-http-runtime",
    build: "2026-11-16-hono-router-1",
  });
});

test("readiness fails closed and reports missing runtime configuration", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/ready"), {}, context);
  assert.equal(response.status, 503);
  const body = await response.json() as { status: string; missing: string[] };
  assert.equal(body.status, "not_ready");
  assert.ok(body.missing.includes("SUPABASE_URL"));
  assert.ok(body.missing.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(body.missing.includes("TELEGRAM_BOT_TOKEN"));
  assert.ok(body.missing.includes("BOT_API_SECRET"));
  assert.ok(body.missing.includes("CORS_ORIGIN"));
  assert.ok(body.missing.includes("GAME_ADMIN_TELEGRAM_IDS"));
});


test("pilot analytics endpoint rejects requests without the Bot/API secret", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/internal/pilot/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventName: "bot_start", userKey: "a".repeat(32), source: "bot" }),
  }), configuredEnv, context);
  assert.equal(response.status, 401);
});

test("pilot analytics endpoint validates event payloads before database access", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/internal/pilot/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-football-bot-secret": configuredEnv.BOT_API_SECRET },
    body: JSON.stringify({ eventName: "raw_message_text", userKey: "a".repeat(32), source: "bot" }),
  }), configuredEnv, context);
  assert.equal(response.status, 400);
});

test("pilot analytics endpoint persists an authenticated pseudonymous event through Supabase HTTPS", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl: URL | undefined;
  globalThis.fetch = async (input) => {
    requestUrl = new URL(String(input));
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://api.example.test/internal/pilot/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-football-bot-secret": configuredEnv.BOT_API_SECRET },
      body: JSON.stringify({ eventName: "bot_start", userKey: "a".repeat(32), actionKey: "start", chatType: "private", source: "bot" }),
    }), {
      ...configuredEnv,
      SUPABASE_URL: "https://example-project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough-for-tests",
    }, context);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
    assert.equal(requestUrl?.pathname, "/rest/v1/PilotAnalyticsEvent");
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all(pending.splice(0));
  }
});

test("the Worker dispatches Fetch requests through the shared API route handlers", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/not-a-route"), configuredEnv, context);
  assert.equal(response.status, 404);
  await Promise.all(pending.splice(0));
});

test("readiness checks schema through Supabase HTTPS without DATABASE_URL", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl: URL | undefined;
  let requestedHeaders: Headers | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = new URL(String(input));
    requestedHeaders = new Headers(init?.headers);
    return new Response("true", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://api.example.test/ready"), {
      ...configuredEnv,
      SUPABASE_URL: "https://example-project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-that-is-long-enough-for-tests",
    }, context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ready",
      service: "football-empire-cloudflare-api",
      database: "connected",
      database_transport: "supabase_https",
      schema: "current",
    });
    assert.equal(requestedUrl?.pathname, "/rest/v1/rpc/football_runtime_readiness");
    assert.equal(requestedHeaders?.get("authorization"), "Bearer service-role-key-that-is-long-enough-for-tests");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("Telegram auth route retains the shared API request validation", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/v1/auth/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: "" }),
  }), configuredEnv, context);
  assert.equal(response.status, 400);
  await Promise.all(pending.splice(0));
});

test("Worker router handles allowed CORS preflight without opening a database connection", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/v1/store", {
    method: "OPTIONS",
    headers: {
      origin: "https://web.example.test",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type",
    },
  }), configuredEnv, context);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://web.example.test");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("Worker router rejects disallowed cross-origin requests", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/v1/store", {
    headers: { origin: "https://attacker.example.test" },
  }), configuredEnv, context);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "CORS_ORIGIN_NOT_ALLOWED" });
  await Promise.all(pending.splice(0));
});

test("production Worker requests receive strict transport security headers", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.test/not-a-route"),
    {
      ...configuredEnv,
      ENVIRONMENT: "production",
    },
    context,
  );
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  await Promise.all(pending.splice(0));
});
