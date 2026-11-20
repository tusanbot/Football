
import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/app.js";

test("public player records validate metric and limit without authentication", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const responses = await Promise.all([
    app.inject({ method: "GET", url: "/v1/players/records?metric=unknown" }),
    app.inject({ method: "GET", url: "/v1/players/records?limit=0" }),
    app.inject({ method: "GET", url: "/v1/players/records?metric=goals&limit=51" }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [400, 400, 400]);
});

test("public player records fail closed without the Supabase repository", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const response = await app.inject({ method: "GET", url: "/v1/players/records?metric=goals" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, "SUPABASE_PUBLIC_PLAYER_RECORDS_UNAVAILABLE");
});

test("public player records are served by the injected repository", async (t) => {
  const calls: unknown[] = [];
  const repository = {
    async list(metric: string, limit: number) {
      calls.push({ metric, limit });
      return [{
        playerId: "player-1", playerName: "Test Player", position: "ST", overall: 90,
        clubName: "Test Club", appearances: 4, goals: 5, assists: 2,
        minutesPlayed: 360, averageRating: 8.25, value: 5,
      }];
    },
  };
  const app = buildApp({ publicPlayerRecordRepository: repository });
  await app.ready();
  t.after(async () => app.close());
  const response = await app.inject({ method: "GET", url: "/v1/players/records?metric=goals&limit=10" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().records[0].rank, 1);
  assert.deepEqual(calls, [{ metric: "goals", limit: 10 }]);
});
