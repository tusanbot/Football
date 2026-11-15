import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("match and competition endpoints require Telegram authentication", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const requests = [
    app.inject({ method: "GET", url: "/v1/matches" }),
    app.inject({ method: "GET", url: "/v1/matches/opponents" }),
    app.inject({ method: "POST", url: "/v1/matches/friendly", payload: {} }),
    app.inject({ method: "POST", url: "/v1/matches/m1/checkpoints/half/decisions", payload: {} }),
    app.inject({ method: "GET", url: "/v1/competitions" }),
    app.inject({ method: "POST", url: "/v1/competitions", payload: {} }),
  ];
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((response) => response.statusCode), [401, 401, 401, 401, 401, 401]);
});
