import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("player development endpoints require Telegram authentication", async () => {
  const app = buildApp();
  try {
    const overview = await app.inject({ method: "GET", url: "/v1/club/development" });
    const training = await app.inject({
      method: "POST",
      url: "/v1/club/players/player-1/train",
      payload: { focus: "SHOOTING", intensity: "NORMAL", idempotencyKey: "test-training-001" },
    });
    const renewal = await app.inject({
      method: "POST",
      url: "/v1/club/players/player-1/contract/renew",
      payload: { extensionDays: 180, weeklyWage: "200", idempotencyKey: "test-renewal-001" },
    });
    assert.equal(overview.statusCode, 401);
    assert.equal(training.statusCode, 401);
    assert.equal(renewal.statusCode, 401);
  } finally {
    await app.close();
  }
});
