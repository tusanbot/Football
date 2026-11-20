import { AsyncLocalStorage } from "node:async_hooks";

export interface ClubEconomySettlement {
  elapsedDays: number;
  sponsorIncome: string;
  operatingCost: string;
  paid: string;
  arrears: string;
}
export interface ClubEconomySettlementPort {
  settle(userId: string, now: Date): Promise<ClubEconomySettlement>;
}
const scope = new AsyncLocalStorage<ClubEconomySettlementPort>();
export function withClubEconomySettlementPort<T>(port: ClubEconomySettlementPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getClubEconomySettlementPort(): ClubEconomySettlementPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("CLUB_ECONOMY_SETTLEMENT_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
