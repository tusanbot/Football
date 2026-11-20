import { AsyncLocalStorage } from "node:async_hooks";

export interface FriendlyMatchRecord {
  id: string;
  idempotencyKey: string;
  type: "FRIENDLY";
  status: "SCHEDULED";
  homeClubId: string;
  awayClubId: string;
  competitionId: string | null;
  rulesSnapshot: unknown;
  tieId: string | null;
  leg: number;
  round: number | null;
  scheduledAt: Date | string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  seed: string;
  simulationVersion: number;
  homeScore: number | null;
  awayScore: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  winnerClubId: string | null;
  attendance: number;
  ticketRevenue: bigint | number | string;
  homeExpectedGoals: number | null;
  awayExpectedGoals: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
export interface FriendlyMatchCreationPort {
  create(userId: string, opponentClubId: string, idempotencyKey: string, scheduledAt: Date): Promise<{
    match: FriendlyMatchRecord;
    replayed: boolean;
  }>;
}
const scope = new AsyncLocalStorage<FriendlyMatchCreationPort>();
export function withFriendlyMatchCreationPort<T>(port: FriendlyMatchCreationPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getFriendlyMatchCreationPort(): FriendlyMatchCreationPort | undefined {
  const port = scope.getStore();
  if (!port && process.env.NODE_ENV === "production") throw new Error("FRIENDLY_MATCH_SUPABASE_REPOSITORY_REQUIRED");
  return port;
}
