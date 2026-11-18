export interface MarketPurchaseCommand {
  userId: string;
  listingId: string;
}

export type MarketPurchaseResult =
  | { listingId: string; playerId: string; price: string; replayed: boolean }
  | { error: "PLAYER_CONTRACT_EXPIRED" | "LISTING_EXPIRED" };

export interface MarketPurchasePort {
  purchase(input: MarketPurchaseCommand): Promise<MarketPurchaseResult>;
}
