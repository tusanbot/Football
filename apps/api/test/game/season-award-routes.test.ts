import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/app.js";

test("season awards reject invalid season and query parameters", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const responses = await Promise.all([
    app.inject({ method: "GET", url: "/v1/seasons/1900/awards" }),
    app.inject({ method: "GET", url: "/v1/seasons/2026/awards?minimumAppearances=0" }),
    app.inject({ method: "GET", url: "/v1/seasons/2026/awards?unexpected=true" }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [400, 400, 400]);
});
