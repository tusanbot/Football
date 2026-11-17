import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("event tournament player and admin routes require authenticated Telegram users", async (t) => {
  const app = buildApp({ logger: false });
  await app.ready();
  t.after(async () => app.close());

  const playerList = await app.inject({ method: "GET", url: "/v1/event-tournaments" });
  assert.equal(playerList.statusCode, 401);
  assert.deepEqual(playerList.json(), { error: "UNAUTHENTICATED" });

  const join = await app.inject({ method: "POST", url: "/v1/event-tournaments/example/join", payload: {} });
  assert.equal(join.statusCode, 401);
  assert.deepEqual(join.json(), { error: "UNAUTHENTICATED" });

  const adminList = await app.inject({ method: "GET", url: "/v1/admin/event-tournaments" });
  assert.equal(adminList.statusCode, 401);
  assert.deepEqual(adminList.json(), { error: "UNAUTHENTICATED" });

  const create = await app.inject({ method: "POST", url: "/v1/admin/event-tournaments", payload: {} });
  assert.equal(create.statusCode, 401);
  assert.deepEqual(create.json(), { error: "UNAUTHENTICATED" });
});
