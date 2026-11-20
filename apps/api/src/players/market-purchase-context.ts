import { AsyncLocalStorage } from "node:async_hooks";

export interface MarketPurchaseCommand {
  userId: string;
  listingId: string;
}

export type MarketPurchaseResult =
  | { listingId: string; playerId: string; price: string; replayed: boolean }
  | { error: "PLAYER_CONTRACT_EXPIRED" | "LISTING_EXPIRED" };

export interface MarketPurchasePort {
  getSellerUserId(listingId: string): Promise<string | null>;
  purchase(input: MarketPurchaseCommand): Promise<MarketPurchaseResult>;
}


const marketPurchaseScope = new AsyncLocalStorage<MarketPurchasePort>();

export function withMarketPurchasePort<T>(port: MarketPurchasePort, operation: () => T): T {
  return marketPurchaseScope.run(port, operation);
}

export function getMarketPurchasePort(): MarketPurchasePort | undefined {
  const port = marketPurchaseScope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("MARKET_PURCHASE_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
