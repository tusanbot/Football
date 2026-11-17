import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("match and competition endpoints require Telegram authentication", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const requests = [
    app.inject({ method: "GET", url: "/v1/me" }),
    app.inject({ method: "PATCH", url: "/v1/club", payload: { name: "New Club" } }),
    app.inject({ method: "GET", url: "/v1/matches" }),
    app.inject({ method: "GET", url: "/v1/matches/opponents" }),
    app.inject({ method: "GET", url: "/v1/matches/opponents?q=match-club" }),
    app.inject({ method: "POST", url: "/v1/matches/friendly", payload: {} }),
    app.inject({ method: "POST", url: "/v1/matches/m1/checkpoints/half/decisions", payload: {} }),
    app.inject({ method: "GET", url: "/v1/competitions" }),
    app.inject({ method: "POST", url: "/v1/competitions", payload: {} }),
    app.inject({ method: "GET", url: "/v1/pyramid-leagues" }),
    app.inject({ method: "GET", url: "/v1/pyramid-leagues/history" }),
    app.inject({ method: "PUT", url: "/v1/club/logo", payload: { mimeType: "image/png", base64: "AA==" } }),
    app.inject({ method: "DELETE", url: "/v1/club/logo" }),
    app.inject({ method: "POST", url: "/v1/pyramid-leagues/apply", payload: { tier: 1 } }),
    app.inject({ method: "GET", url: "/v1/league-notices" }),
    app.inject({ method: "POST", url: "/v1/friendly-challenges", payload: {} }),
    app.inject({ method: "GET", url: "/v1/friendly-challenges/abcdefghijklmnop" }),
  ];
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((response) => response.statusCode), [401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401]);
});

test("fallback-plan endpoints require Telegram authentication", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const responses = await Promise.all([
    app.inject({ method: "GET", url: "/v1/matches/fallback-plan" }),
    app.inject({
      method: "PUT",
      url: "/v1/matches/fallback-plan",
      payload: {
        expectedVersion: 1,
        plan: {
          formation: "4-3-3",
          mentality: "BALANCED",
          pressing: "MID_BLOCK",
          tempo: "NORMAL",
          passingStyle: "MIXED",
        },
      },
    }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [401, 401]);
});
