import { AsyncLocalStorage } from "node:async_hooks";

export interface MatchRuntimeSettlementCommand {
  matchId: string;
  runtimeId: string;
  leaseToken: string;
  now: string;
  result: unknown;
  injuryDurationDays: number;
  redCardSuspensionMatches: number;
  yellowCardsToSuspend: number;
  yellowCardSuspensionMatches: number;
  homeReward: string;
  awayReward: string;
}
export interface MatchRuntimeSettlementResult {
  replayed: boolean;
  matchId: string;
  competitionId: string | null;
  round: number | null;
  homeClub: string;
  awayClub: string;
  homeScore: number | null;
  awayScore: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  winnerClubId: string | null;
  attendance: number;
  ticketRevenue: string;
  events: Array<Record<string, unknown>>;
}
export interface MatchRuntimeSettlementPort {
  settle(input: MatchRuntimeSettlementCommand): Promise<MatchRuntimeSettlementResult>;
}
const scope = new AsyncLocalStorage<MatchRuntimeSettlementPort>();
export function withMatchRuntimeSettlementPort<T>(port: MatchRuntimeSettlementPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getMatchRuntimeSettlementPort(): MatchRuntimeSettlementPort | undefined {
  return scope.getStore();
}
