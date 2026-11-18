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

export interface MarketListingPort {
  create(input: MarketListingCreateCommand): Promise<MarketListingCreated>;
}

const marketListingScope = new AsyncLocalStorage<MarketListingPort>();

export function withMarketListingPort<T>(port: MarketListingPort, operation: () => T): T {
  return marketListingScope.run(port, operation);
}

export function getMarketListingPort(): MarketListingPort | undefined {
  return marketListingScope.getStore();
}
