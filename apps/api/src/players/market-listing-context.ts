import { AsyncLocalStorage } from "node:async_hooks";

export interface MarketListingCreateCommand {
  userId: string;
  playerId: string;
  askingPrice: string;
  expiresInHours: number;
}

export interface MarketListingCreated {
  id: string;
  playerId: string;
  askingPrice: string;
  status: "OPEN";
  expiresAt: string;
  createdAt: string;
}

export interface MarketListingCancelCommand {
  userId: string;
  listingId: string;
}

export interface MarketListingCancelled {
  listingId: string;
  status: "CANCELLED";
}

export interface MarketListingPort {
  create(input: MarketListingCreateCommand): Promise<MarketListingCreated>;
  cancel(input: MarketListingCancelCommand): Promise<MarketListingCancelled>;
  listOpen(): Promise<unknown[]>;
  listMine(userId: string): Promise<unknown[]>;
}

const marketListingScope = new AsyncLocalStorage<MarketListingPort>();

export function withMarketListingPort<T>(port: MarketListingPort, operation: () => T): T {
  return marketListingScope.run(port, operation);
}

export function getMarketListingPort(): MarketListingPort | undefined {
  const port = marketListingScope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("MARKET_LISTING_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
