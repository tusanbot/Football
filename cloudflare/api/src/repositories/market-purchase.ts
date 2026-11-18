import type { MarketPurchaseCommand, MarketPurchasePort, MarketPurchaseResult } from "../../../../apps/api/src/players/market-purchase-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../supabase-http.js";

interface MarketPurchaseRpcRow {
  listing_id: string;
  player_id: string;
  price: string;
  replayed: boolean;
  error_code: string | null;
}

const MARKET_ERROR_CODES = new Set([
  "CLUB_NOT_FOUND",
  "LISTING_NOT_FOUND",
  "LISTING_NOT_OPEN",
  "CANNOT_BUY_OWN_PLAYER",
  "WALLET_NOT_FOUND",
  "INSUFFICIENT_FUNDS",
  "CONCURRENT_MODIFICATION",
  "PLAYER_OWNERSHIP_CHANGED",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_AMOUNT",
]);

export class SupabaseMarketPurchaseRepository implements MarketPurchasePort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async purchase(input: MarketPurchaseCommand): Promise<MarketPurchaseResult> {
    let rows: MarketPurchaseRpcRow[];
    try {
      rows = await this.client.rpc<MarketPurchaseRpcRow[]>("buy_market_listing", {
        p_user_id: input.userId,
        p_listing_id: input.listingId,
      });
    } catch (error) {
      const message = error instanceof SupabaseHttpError ? error.message : error instanceof Error ? error.message : "";
      const code = message.toLowerCase().includes("duplicate key") || message.toLowerCase().includes("unique constraint")
        ? "IDEMPOTENCY_CONFLICT"
        : [...MARKET_ERROR_CODES].find((candidate) => message.includes(candidate));
      if (code) throw Object.assign(new Error(message), { code });
      throw error;
    }

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || row.listing_id !== input.listingId || typeof row.replayed !== "boolean") {
      throw new Error("SUPABASE_MARKET_PURCHASE_INVALID_RESPONSE");
    }
    if (row.error_code === "PLAYER_CONTRACT_EXPIRED" || row.error_code === "LISTING_EXPIRED") {
      return { error: row.error_code };
    }
    if (row.error_code || typeof row.player_id !== "string" || typeof row.price !== "string" || !/^-?\d+$/.test(row.price)) {
      throw new Error("SUPABASE_MARKET_PURCHASE_INVALID_RESPONSE");
    }
    return { listingId: row.listing_id, playerId: row.player_id, price: row.price, replayed: row.replayed };
  }
}
