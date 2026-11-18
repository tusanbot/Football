import type { MarketListingCreateCommand, MarketListingCreated, MarketListingPort } from "../../../../apps/api/src/players/market-listing-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../supabase-http.js";

interface MarketListingRpcRow {
  listing_id: string;
  player_id: string;
  asking_price: string;
  status: string;
  expires_at: string;
  created_at: string;
}

const MARKET_LISTING_ERRORS = new Set([
  "INVALID_LISTING",
  "CLUB_NOT_FOUND",
  "PLAYER_NOT_FOUND",
  "SPECIAL_PLAYERS_NOT_TRADEABLE",
  "PLAYER_NOT_AVAILABLE",
  "MARKET_LOCKED_DURING_MATCH",
  "MINIMUM_ACTIVE_SQUAD_REQUIRED",
  "LISTING_NOT_FOUND",
  "LISTING_NOT_OPEN",
  "PLAYER_OWNERSHIP_CHANGED",
]);

function mapMarketListingError(error: unknown): never {
  const message = error instanceof SupabaseHttpError ? error.message : error instanceof Error ? error.message : "";
  const code = [...MARKET_LISTING_ERRORS].find((candidate) => message.includes(candidate));
  if (code) throw Object.assign(new Error(code), { code });
  throw error;
}

export class SupabaseMarketListingRepository implements MarketListingPort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async create(input: MarketListingCreateCommand): Promise<MarketListingCreated> {
    let rows: MarketListingRpcRow[];
    try {
      rows = await this.client.rpc<MarketListingRpcRow[]>("create_market_listing", {
        p_user_id: input.userId,
        p_player_id: input.playerId,
        p_asking_price: input.askingPrice,
        p_expires_in_hours: input.expiresInHours,
      });
    } catch (error) { return mapMarketListingError(error); }

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || typeof row.listing_id !== "string" || row.player_id !== input.playerId
      || row.asking_price !== input.askingPrice || row.status !== "OPEN"
      || typeof row.expires_at !== "string" || typeof row.created_at !== "string"
      || !Number.isFinite(Date.parse(row.expires_at)) || !Number.isFinite(Date.parse(row.created_at))) {
      throw new Error("SUPABASE_MARKET_LISTING_INVALID_RESPONSE");
    }
    return {
      id: row.listing_id,
      playerId: row.player_id,
      askingPrice: row.asking_price,
      status: "OPEN",
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  async listOpen(): Promise<unknown[]> {
    let rows: unknown;
    try { rows = await this.client.rpc<unknown>("get_open_market_listings", {}); }
    catch (error) { return mapMarketListingError(error); }
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error("SUPABASE_MARKET_LISTINGS_INVALID_RESPONSE");
    }
    return rows;
  }

  async cancel(input: { userId: string; listingId: string }): Promise<{ listingId: string; status: "CANCELLED" }> {
    let rows: Array<{ listing_id: string; status: string }>;
    try {
      rows = await this.client.rpc<Array<{ listing_id: string; status: string }>>("cancel_market_listing", {
        p_user_id: input.userId,
        p_listing_id: input.listingId,
      });
    } catch (error) { return mapMarketListingError(error); }

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || row.listing_id !== input.listingId || row.status !== "CANCELLED") {
      throw new Error("SUPABASE_MARKET_LISTING_CANCEL_INVALID_RESPONSE");
    }
    return { listingId: row.listing_id, status: "CANCELLED" };
  }
}
