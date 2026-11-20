import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseGiftCodeRedemptionRepository } from "../src/repositories/gift-code-redemption.js";

test("gift-code repository calls the atomic RPC and preserves reward amounts as strings", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{ cash: "9007199254740993123", gold: "15", group_points: "0", replayed: false }];
    },
  } as never;
  const result = await new SupabaseGiftCodeRedemptionRepository(client).redeem({
    userId: "user-1", code: "WELCOME", idempotencyKey: "gift-code-test-0001",
  });
  assert.equal(call?.name, "redeem_gift_code");
  assert.equal(call?.args.p_code, "WELCOME");
  assert.equal(result.reward.cash, "9007199254740993123");
  assert.equal(result.replayed, false);
});

test("gift-code repository rejects malformed RPC responses", async () => {
  const client = { rpc: async () => [{ cash: 1, gold: "0", group_points: "0", replayed: true }] } as never;
  await assert.rejects(() => new SupabaseGiftCodeRedemptionRepository(client).redeem({
    userId: "user-1", code: "WELCOME", idempotencyKey: "gift-code-test-0002",
  }), /SUPABASE_GIFT_CODE_INVALID_RESPONSE/);
});


test("gift-code rate limit is consumed through an atomic Supabase RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { call = { name, args }; return [true]; } } as never;
  const allowed = await new SupabaseGiftCodeRedemptionRepository(client).consumeRateLimit({ telegramUserId: "123456789", limit: 5 });
  assert.equal(allowed, true);
  assert.equal(call?.name, "consume_gift_code_rate_limit");
  assert.equal(call?.args.p_telegram_user_id, "123456789");
  assert.equal(call?.args.p_limit, 5);
});

test("gift-code rate limit rejects exhausted windows", async () => {
  const client = { rpc: async () => [false] } as never;
  assert.equal(await new SupabaseGiftCodeRedemptionRepository(client).consumeRateLimit({ telegramUserId: "123456789", limit: 5 }), false);
});


test("gift-code preflight reads reward type through Supabase RPC", async () => {
  let called = "";
  const client = { rpc: async (name: string) => { called = name; return ["GROUP_POINTS"]; } } as never;
  const result = await new SupabaseGiftCodeRedemptionRepository(client).getRewardType("GROUP123");
  assert.equal(called, "get_gift_code_reward_type");
  assert.equal(result, "GROUP_POINTS");
});
