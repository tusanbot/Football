import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("group endpoints require the authenticated Bot channel", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "group-test-secret";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  });

  const responses = await Promise.all([
    app.inject({ method: "POST", url: "/v1/groups/register", payload: { telegramGroupId: "-100123", title: "Test", role: "ADMIN" } }),
    app.inject({ method: "POST", url: "/v1/groups/join", payload: { telegramGroupId: "-100123" } }),
    app.inject({ method: "GET", url: "/v1/groups/-100123" }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [401, 401, 401]);
});

test("group registration validates Telegram group identity and role", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "group-test-secret";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/groups/register",
    headers: { "x-football-bot-secret": "group-test-secret", "x-telegram-user-id": "12345" },
    payload: { telegramGroupId: "not-a-telegram-id", title: "Test", role: "MEMBER" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "INVALID_GROUP_REGISTRATION");
});
