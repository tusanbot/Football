import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { BotRuntimeLeasePort } from "../src/bot-runtime-lease-context.js";

test("Bot identity verification is protected by the shared Bot API secret", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "runtime-identity-test-secret";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  });
  const response = await app.inject({
    method: "POST", url: "/v1/bot/verify-identity",
    payload: { telegramBotId: 123456 },
  });
  assert.equal(response.statusCode, 401);
});

test("Bot polling lease routes delegate acquire, heartbeat and release to the Supabase port", async (t) => {
  const previousSecret = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "runtime-lease-test-secret-with-32-chars";
  const calls: Array<{instanceId:string;action:string;now:string}> = [];
  const port: BotRuntimeLeasePort = {
    async execute(instanceId, action, now) {
      calls.push({instanceId,action,now});
      return {
        acquired: action !== "acquire" || instanceId === "11111111-1111-4111-8111-111111111111",
        released: action === "release" && instanceId === "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: action === "release" ? null : "2026-11-19T12:01:00.000Z",
      };
    },
  };
  const app = buildApp({ botRuntimeLeasePort: port });
  await app.ready();
  try {
    const headers = { "x-football-bot-secret": process.env.BOT_API_SECRET! };
    const call = (instanceId:string, action:string) => app.inject({
      method:"POST",url:"/v1/bot/runtime/lease",headers,payload:{instanceId,action},
    });
    const instanceA="11111111-1111-4111-8111-111111111111";
    const instanceB="22222222-2222-4222-8222-222222222222";
    const acquired=await call(instanceA,"acquire");
    assert.equal(acquired.statusCode,200);
    assert.equal(acquired.json().acquired,true);
    const rejected=await call(instanceB,"acquire");
    assert.equal(rejected.json().acquired,false);
    const renewed=await call(instanceA,"heartbeat");
    assert.equal(renewed.json().acquired,true);
    const released=await call(instanceA,"release");
    assert.equal(released.json().released,true);
    assert.deepEqual(calls.map((item)=>item.action),["acquire","acquire","heartbeat","release"]);
  } finally {
    await app.close();
    if (previousSecret === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previousSecret;
  }
});

test("Bot polling lease fails closed when the Supabase lease port is unavailable", async (t) => {
  const previousSecret=process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET="runtime-lease-test-secret-with-32-chars";
  const app=buildApp();
  await app.ready();
  try {
    const response=await app.inject({
      method:"POST",url:"/v1/bot/runtime/lease",
      headers:{"x-football-bot-secret":process.env.BOT_API_SECRET!},
      payload:{instanceId:"11111111-1111-4111-8111-111111111111",action:"acquire"},
    });
    assert.equal(response.statusCode,503);
    assert.equal(response.json().error,"SUPABASE_BOT_RUNTIME_LEASE_UNAVAILABLE");
  } finally {
    await app.close();
    if(previousSecret===undefined)delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET=previousSecret;
  }
});
