import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseStorePurchaseRepository } from "../src/repositories/store-purchase.js";

test("store purchase repository calls the atomic RPC and preserves bigint strings", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{ item_key: "recovery_kit", purchased_quantity: 2, balance: "9007199254740993123", inventory: 5, replayed: false }];
    },
  } as never;
  const result = await new SupabaseStorePurchaseRepository(client).purchase({
    userId: "user-1", itemKey: "recovery_kit", asset: "CASH", unitPrice: "1200",
    quantity: 2, idempotencyKey: "store-test-0001",
  });
  assert.equal(call?.name, "purchase_store_item");
  assert.equal(call?.args.p_unit_price, "1200");
  assert.equal(result.balance, "9007199254740993123");
  assert.equal(result.inventory, 5);
  assert.equal(result.replayed, false);
});

test("store purchase repository rejects malformed RPC payloads", async () => {
  const client = { rpc: async () => ({ balance: 1 }) } as never;
  await assert.rejects(() => new SupabaseStorePurchaseRepository(client).purchase({
    userId: "user-1", itemKey: "recovery_kit", asset: "CASH", unitPrice: "1200",
    quantity: 1, idempotencyKey: "store-test-0002",
  }), /SUPABASE_STORE_PURCHASE_INVALID_RESPONSE/);
});
