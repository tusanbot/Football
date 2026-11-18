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
