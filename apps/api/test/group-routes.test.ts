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

test("group registration refuses groups below the ten-member threshold", async (t) => {
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
    payload: { telegramGroupId: "-100123", title: "Small group", role: "OWNER", memberCount: 9 },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error, "GROUP_MINIMUM_MEMBERS_REQUIRED");
  assert.equal(response.json().minimumMembers, 10);
});

test("group activity requires a valid Telegram group id", async (t) => {
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
    url: "/v1/groups/activity",
    headers: { "x-football-bot-secret": "group-test-secret", "x-telegram-user-id": "12345" },
    payload: { telegramGroupId: "invalid" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "INVALID_GROUP_ACTIVITY");
});

test("new group routes require Bot authentication",async t=>{
 const old=process.env.BOT_API_SECRET;process.env.BOT_API_SECRET="group-test-secret";const app=buildApp();await app.ready();
 t.after(async()=>{await app.close();if(old===undefined)delete process.env.BOT_API_SECRET;else process.env.BOT_API_SECRET=old;});
 const rs=await Promise.all([app.inject({method:"GET",url:"/v1/groups/-100123/shop"}),app.inject({method:"POST",url:"/v1/groups/-100123/shop/purchase",payload:{}}),app.inject({method:"GET",url:"/v1/groups/-100123/challenges"}),app.inject({method:"POST",url:"/v1/groups/-100123/leagues",payload:{}})]);
 assert.deepEqual(rs.map(r=>r.statusCode),[401,401,401,401]);
});
