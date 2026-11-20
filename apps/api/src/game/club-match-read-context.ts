import { AsyncLocalStorage } from "node:async_hooks";

export interface ClubMatchReadPort {
  list(userId: string): Promise<{
    clubId: string;
    matches: Array<{
      id: string; type: "FRIENDLY" | "LEAGUE" | "CUP"; status: string; round: number | null;
      leg: number; tieId: string | null; rulesSnapshot: unknown; simulationVersion: number;
      scheduledAt: string; homeClubId: string; awayClubId: string;
      homeClub: { id: string; name: string }; awayClub: { id: string; name: string };
      homeScore: number | null; awayScore: number | null; attendance: number; ticketRevenue: string;
      homePenalties: number | null; awayPenalties: number | null; winnerClubId: string | null;
      runtime: null | { status: string; currentMinute: number; nextActionAt: string | null; completedAt: string | null; simulationState: unknown; kickoffSnapshot: unknown };
      checkpoints: Array<{ checkpointKey: string; kind: string; minute: number; status: string; openedAt: string; decisionDeadlineAt: string; nextSegmentAt: string; resolvedAt: string | null; decisions: Array<{ clubId: string; submittedAt: string }> }>;
      events: Array<{ minute: number; type: string; teamId: string; playerId: string; relatedPlayerId: string | null; detail: string; playerName: string; relatedPlayerName: string | null }>;
    }>;
    competitions: Array<{ id: string; name: string; season: number; format: "LEAGUE" | "CUP"; cupLegs: number; status: string }>;
  }>;
}
const scope = new AsyncLocalStorage<ClubMatchReadPort>();
export function withClubMatchReadPort<T>(port: ClubMatchReadPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getClubMatchReadPort(): ClubMatchReadPort | undefined {
  const port = scope.getStore();
  if (!port && process.env.NODE_ENV === "production") throw new Error("CLUB_MATCH_READ_SUPABASE_REPOSITORY_REQUIRED");
  return port;
}
