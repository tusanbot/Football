import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMarketPurchaseRepository } from "../src/repositories/market-purchase.js";

test("market purchase repository calls the atomic RPC and preserves exact price strings", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{ listing_id: "listing-1", player_id: "player-1", price: "9007199254740993123", replayed: false, error_code: null }];
    },
  } as never;
  const repository = new SupabaseMarketPurchaseRepository(client);
  const result = await repository.purchase({ userId: "buyer-1", listingId: "listing-1" });
  assert.equal(call?.name, "buy_market_listing");
  assert.equal(call?.args.p_listing_id, "listing-1");
  assert.equal(result.replayed, false);
  assert.equal("price" in result ? result.price : "", "9007199254740993123");
});

test("market purchase repository preserves expiry outcomes as domain results", async () => {
  const client = {
    rpc: async () => [{ listing_id: "listing-1", player_id: "player-1", price: "100", replayed: false, error_code: "LISTING_EXPIRED" }],
  } as never;
  const result = await new SupabaseMarketPurchaseRepository(client).purchase({ userId: "buyer-1", listingId: "listing-1" });
  assert.deepEqual(result, { error: "LISTING_EXPIRED" });
});
