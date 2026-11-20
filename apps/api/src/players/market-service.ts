import { settleClubDailyState } from "./player-development-service.js";
import { getPlayerDevelopmentPort } from "./player-development-context.js";
import { getMarketPurchasePort } from "./market-purchase-context.js";
import { getMarketListingPort } from "./market-listing-context.js";

export class MarketError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MarketError"; }
}

async function settleClub(userId: string) {
  if (!getPlayerDevelopmentPort()) throw new MarketError("SUPABASE_PLAYER_DEVELOPMENT_UNAVAILABLE");
  await settleClubDailyState(userId);
}

export async function createMarketListing(userId: string, playerId: string, askingPrice: bigint, expiresInHours: number) {
  await settleClub(userId);
  const port = getMarketListingPort();
  if (!port) throw new MarketError("SUPABASE_MARKET_LISTING_UNAVAILABLE");
  try {
    return await port.create({ userId, playerId, askingPrice: askingPrice.toString(), expiresInHours });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (code) throw new MarketError(code);
    throw error;
  }
}

export async function buyMarketListing(userId: string, listingId: string) {
  await settleClub(userId);
  const port = getMarketPurchasePort();
  if (!port) throw new MarketError("SUPABASE_MARKET_PURCHASE_UNAVAILABLE");
  try {
    const sellerUserId = await port.getSellerUserId(listingId);
    if (sellerUserId && sellerUserId !== userId) await settleClub(sellerUserId);
    return await port.purchase({ userId, listingId });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (code) throw new MarketError(code);
    throw error;
  }
}

export async function cancelMarketListing(userId: string, listingId: string) {
  await settleClub(userId);
  const port = getMarketListingPort();
  if (!port) throw new MarketError("SUPABASE_MARKET_LISTING_UNAVAILABLE");
  try { return await port.cancel({ userId, listingId }); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (code) throw new MarketError(code);
    throw error;
  }
}

export async function getOpenMarketListings() {
  const port = getMarketListingPort();
  if (!port) throw new MarketError("SUPABASE_MARKET_LISTING_UNAVAILABLE");
  try { return await port.listOpen(); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (code) throw new MarketError(code);
    throw error;
  }
}
