import { AsyncLocalStorage } from "node:async_hooks";
import type { CompetitionAdvancementResult } from "./competition-advancement-context.js";

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
  advancement: CompetitionAdvancementResult | null;
  pyramidFinalization: Record<string, unknown> | null;
  eventTournamentFinalization: Record<string, unknown> | null;
}
export interface MatchRuntimeSettlementPort {
  settle(input: MatchRuntimeSettlementCommand): Promise<MatchRuntimeSettlementResult>;
}
const scope = new AsyncLocalStorage<MatchRuntimeSettlementPort>();
export function withMatchRuntimeSettlementPort<T>(port: MatchRuntimeSettlementPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getMatchRuntimeSettlementPort(): MatchRuntimeSettlementPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("MATCH_RUNTIME_SETTLEMENT_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
