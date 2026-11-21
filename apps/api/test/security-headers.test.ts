import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("API responses include baseline browser security headers", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers.pragma, "no-cache");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
});


test("CORS reflects only explicitly configured origins", async (t) => {
  const previous = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = "https://game.example,https://admin.example";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previous;
  });

  const allowed = await app.inject({
    method: "OPTIONS",
    url: "/v1/me",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(allowed.headers["access-control-allow-origin"], "https://game.example");
  assert.equal(allowed.headers["access-control-allow-credentials"], "true");

  const denied = await app.inject({
    method: "OPTIONS",
    url: "/v1/me",
    headers: {
      origin: "https://attacker.example",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});

test("invalid CORS configuration fails closed at request time", async (t) => {
  const previous = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = "*";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previous;
  });

  const response = await app.inject({
    method: "OPTIONS",
    url: "/v1/me",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});
