import assert from "node:assert/strict";
import test from "node:test";
import { cancelMarketListing, createMarketListing, getOpenMarketListings, MarketError, buyMarketListing } from "../src/players/market-service.js";

async function unavailable(operation: Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => error instanceof MarketError && error.code === code);
}

test("market listing creation requires Supabase player settlement and listing ports", async () => {
  await unavailable(createMarketListing("user-1", "player-1", 1000n, 72), "SUPABASE_PLAYER_DEVELOPMENT_UNAVAILABLE");
});

test("market purchase requires Supabase player settlement and purchase ports", async () => {
  await unavailable(buyMarketListing("user-1", "listing-1"), "SUPABASE_PLAYER_DEVELOPMENT_UNAVAILABLE");
});

test("market listing cancellation requires Supabase player settlement and listing ports", async () => {
  await unavailable(cancelMarketListing("user-1", "listing-1"), "SUPABASE_PLAYER_DEVELOPMENT_UNAVAILABLE");
});

test("market discovery never falls back to Prisma", async () => {
  await unavailable(getOpenMarketListings(), "SUPABASE_MARKET_LISTING_UNAVAILABLE");
});
