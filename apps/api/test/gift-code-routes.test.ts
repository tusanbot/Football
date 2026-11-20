import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { GiftCodeRedemptionPort } from "../src/gift-code-redemption-context.js";
import type { TelegramUserLookupPort } from "../src/auth/telegram-user-lookup-context.js";

const actor = { id: "user_test", telegramId: "123456", username: null, displayName: "Test", createdAt: "2026-01-01T00:00:00.000Z" };

async function withAuthEnv<T>(run: () => Promise<T>) {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "gift-code-route-test-secret";
  try { return await run(); }
  finally {
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  }
}

test("gift redemption fails closed when the Supabase port is not configured", async () => withAuthEnv(async () => {
  const lookup: TelegramUserLookupPort = { async loadActiveUser() { return actor; } };
  const app = buildApp({ telegramUserLookupPort: lookup });
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST", url: "/v1/gift-codes/redeem",
      headers: { "x-football-bot-secret": process.env.BOT_API_SECRET!, "x-telegram-user-id": actor.telegramId },
      payload: { code: "WELCOME", idempotencyKey: "gift-test-key-0001" },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, "SUPABASE_GIFT_CODE_REDEMPTION_UNAVAILABLE");
  } finally { await app.close(); }
}));

test("gift redemption delegates rate limit, preflight and atomic redemption to Supabase", async () => withAuthEnv(async () => {
  const calls: string[] = [];
  const lookup: TelegramUserLookupPort = { async loadActiveUser() { return actor; } };
  const port: GiftCodeRedemptionPort = {
    async consumeRateLimit(input) { calls.push("rate:" + input.telegramUserId); return true; },
    async getRewardType(code) { calls.push("type:" + code); return "CASH"; },
    async redeem(input) {
      calls.push("redeem:" + input.code + ":" + input.idempotencyKey);
      return { ok: true, reward: { cash: "500", gold: "0", groupPoints: "0" }, replayed: false };
    },
  };
  const app = buildApp({ telegramUserLookupPort: lookup, giftCodeRedemptionPort: port });
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST", url: "/v1/gift-codes/redeem",
      headers: { "x-football-bot-secret": process.env.BOT_API_SECRET!, "x-telegram-user-id": actor.telegramId },
      payload: { code: "welcome", idempotencyKey: "gift-test-key-0002" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true, reward: { cash: "500", gold: "0", groupPoints: "0" }, replayed: false });
    assert.deepEqual(calls, ["rate:123456", "type:WELCOME", "redeem:WELCOME:gift-test-key-0002"]);
  } finally { await app.close(); }
}));

test("gift redemption rejects rate-limited requests before redemption", async () => withAuthEnv(async () => {
  const lookup: TelegramUserLookupPort = { async loadActiveUser() { return actor; } };
  const port: GiftCodeRedemptionPort = {
    async consumeRateLimit() { return false; },
    async getRewardType() { throw new Error("must not preflight"); },
    async redeem() { throw new Error("must not redeem"); },
  };
  const app = buildApp({ telegramUserLookupPort: lookup, giftCodeRedemptionPort: port });
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST", url: "/v1/gift-codes/redeem",
      headers: { "x-football-bot-secret": process.env.BOT_API_SECRET!, "x-telegram-user-id": actor.telegramId },
      payload: { code: "welcome", idempotencyKey: "gift-test-key-0003" },
    });
    assert.equal(response.statusCode, 429);
    assert.equal(response.json().error, "GIFT_CODE_RATE_LIMITED");
  } finally { await app.close(); }
}));
