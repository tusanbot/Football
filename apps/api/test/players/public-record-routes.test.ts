
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
