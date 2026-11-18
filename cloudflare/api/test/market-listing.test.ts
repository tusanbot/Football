import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMarketListingRepository } from "../src/repositories/market-listing.js";

test("market listing repository calls the atomic RPC and preserves exact price strings", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{
        listing_id: "listing-1",
        player_id: "player-1",
        asking_price: "9007199254740993123",
        status: "OPEN",
        expires_at: "2026-11-21T12:00:00.000Z",
        created_at: "2026-11-18T12:00:00.000Z",
      }];
    },
  } as never;
  const result = await new SupabaseMarketListingRepository(client).create({
    userId: "user-1",
    playerId: "player-1",
    askingPrice: "9007199254740993123",
    expiresInHours: 72,
  });
  assert.equal(call?.name, "create_market_listing");
  assert.equal(call?.args.p_user_id, "user-1");
  assert.equal(call?.args.p_asking_price, "9007199254740993123");
  assert.equal(result.askingPrice, "9007199254740993123");
  assert.equal(result.status, "OPEN");
});

test("market listing cancellation calls the atomic RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{ listing_id: "listing-2", status: "CANCELLED" }];
    },
  } as never;
  const result = await new SupabaseMarketListingRepository(client).cancel({ userId: "user-1", listingId: "listing-2" });
  assert.equal(call?.name, "cancel_market_listing");
  assert.equal(call?.args.p_user_id, "user-1");
  assert.deepEqual(result, { listingId: "listing-2", status: "CANCELLED" });
});

test("market listing repository rejects malformed RPC responses", async () => {
  const client = { rpc: async () => [{ listing_id: "listing-1", player_id: "another-player" }] } as never;
  await assert.rejects(
    () => new SupabaseMarketListingRepository(client).create({
      userId: "user-1", playerId: "player-1", askingPrice: "100", expiresInHours: 24,
    }),
    /SUPABASE_MARKET_LISTING_INVALID_RESPONSE/,
  );
});
