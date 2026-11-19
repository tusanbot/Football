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
  return scope.getStore();
}
