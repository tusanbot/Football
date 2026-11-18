import type { MatchRuntimeCheckpointCommand, MatchRuntimeCheckpointPort, MatchRuntimeCheckpointSnapshot } from "../../../../apps/api/src/game/match-runtime-checkpoint-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseMatchRuntimeCheckpointRepository implements MatchRuntimeCheckpointPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async getOpenCheckpoint(matchId: string): Promise<MatchRuntimeCheckpointSnapshot | null> {
    const result = await this.client.rpc<MatchRuntimeCheckpointSnapshot | null>("get_match_runtime_open_checkpoint", {
      p_match_id: matchId,
    });
    return result;
  }
  async resolveCheckpoint(input: MatchRuntimeCheckpointCommand): Promise<boolean> {
    const result = await this.client.rpc<unknown>("resolve_match_runtime_checkpoint", {
      p_runtime_id: input.runtimeId,
      p_checkpoint_id: input.checkpointId,
      p_expected_state_version: input.expectedStateVersion,
      p_lease_token: input.leaseToken,
      p_resolution: input.resolution,
      p_next_minute: input.nextMinute,
      p_simulation_state: input.simulationState,
      p_next_action_at: input.nextActionAt,
      p_events: input.events.map((event) => ({
        event_key: event.eventKey, kind: event.kind, minute: event.minute,
        home_score: event.homeScore, away_score: event.awayScore,
        payload: event.payload, available_at: event.availableAt,
      })),
      p_next_checkpoint: input.nextCheckpoint ? {
        checkpoint_key: input.nextCheckpoint.checkpointKey,
        kind: input.nextCheckpoint.kind,
        minute: input.nextCheckpoint.minute,
        opened_at: input.nextCheckpoint.openedAt,
        decision_deadline_at: input.nextCheckpoint.decisionDeadlineAt,
        next_segment_at: input.nextCheckpoint.nextSegmentAt,
      } : null,
    });
    if (result !== true && !(Array.isArray(result) && result.length === 1 && result[0] === true)) {
      throw new Error("SUPABASE_MATCH_RUNTIME_CHECKPOINT_REJECTED");
    }
    return true;
  }
}
