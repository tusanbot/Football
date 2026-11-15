import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("API responses include baseline browser security headers", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
});
