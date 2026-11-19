import type { MatchRuntimeAdvancePort, MatchRuntimeFirstHalfCommand } from "../../../../apps/api/src/game/match-runtime-advance-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseMatchRuntimeAdvanceRepository implements MatchRuntimeAdvancePort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async advanceFirstHalf(input: MatchRuntimeFirstHalfCommand): Promise<boolean> {
    const result = await this.client.rpc<unknown>("advance_match_runtime_first_half", {
      p_runtime_id: input.runtimeId,
      p_expected_state_version: input.expectedStateVersion,
      p_lease_token: input.leaseToken,
      p_simulation_state: input.simulationState,
      p_started_at: input.startedAt,
      p_checkpoint_at: input.checkpointAt,
      p_decision_deadline_at: input.decisionDeadlineAt,
      p_events: input.events.map((event) => ({
        event_key: event.eventKey, kind: event.kind, minute: event.minute,
        home_score: event.homeScore, away_score: event.awayScore, payload: event.payload,
        available_at: event.availableAt,
      })),
    });
    if (result !== true && !(Array.isArray(result) && result.length === 1 && result[0] === true)) {
      throw new Error("SUPABASE_MATCH_RUNTIME_FIRST_HALF_REJECTED");
    }
    return true;
  }
}
