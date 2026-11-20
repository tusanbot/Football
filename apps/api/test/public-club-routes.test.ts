import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("club logo mutations require Telegram authentication", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const responses = await Promise.all([
    app.inject({ method: "PUT", url: "/v1/club/logo", payload: { mimeType: "image/png", base64: "iVBORw0KGgo=" } }),
    app.inject({ method: "DELETE", url: "/v1/club/logo" }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [401, 401]);
});

test("public club comparison rejects missing, identical, and malformed club IDs", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const responses = await Promise.all([
    app.inject({ method: "GET", url: "/v1/clubs/compare?first=club-a" }),
    app.inject({ method: "GET", url: "/v1/clubs/compare?first=club-a&second=club-a" }),
    app.inject({ method: "GET", url: "/v1/clubs/compare?first=&second=club-b" }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [400, 400, 400]);
});

test("public club discovery, profile, comparison and logo reads fail closed without Supabase repositories", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const responses = await Promise.all([
    app.inject({ method: "GET", url: "/v1/clubs/public" }),
    app.inject({ method: "GET", url: "/v1/clubs/club-a/profile" }),
    app.inject({ method: "GET", url: "/v1/clubs/compare?first=club-a&second=club-b" }),
    app.inject({ method: "GET", url: "/v1/clubs/club-a/logo" }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [503, 503, 503, 503]);
});
