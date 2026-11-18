import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMatchRuntimeCheckpointRepository } from "../src/repositories/match-runtime-checkpoint.js";

test("checkpoint resolution persists state, lifecycle events and the next checkpoint in one RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new SupabaseMatchRuntimeCheckpointRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return true;
    },
  } as never);
  const command = {
    runtimeId: "runtime-1", checkpointId: "checkpoint-45", expectedStateVersion: 8,
    leaseToken: "lease-token", resolution: { home: { source: "USER" }, away: { source: "FALLBACK" } },
    nextMinute: 60 as const, simulationState: { segment: { currentMinute: 60 } },
    nextActionAt: "2026-11-18T20:01:00.000Z",
    events: [{
      eventKey: "goal:53:4", kind: "GOAL", minute: 53, homeScore: 1, awayScore: 0,
      payload: { scorerName: "Player" }, availableAt: "2026-11-18T20:00:53.000Z",
    }],
    nextCheckpoint: {
      checkpointKey: "minute-60", kind: "MINUTE_60" as const, minute: 60 as const,
      openedAt: "2026-11-18T20:01:00.000Z",
      decisionDeadlineAt: "2026-11-18T20:01:05.000Z",
      nextSegmentAt: "2026-11-18T20:01:05.000Z",
    },
  };
  assert.equal(await repository.resolveCheckpoint(command), true);
  assert.equal(call?.name, "resolve_match_runtime_checkpoint");
  assert.deepEqual(call?.args, {
    p_runtime_id: command.runtimeId, p_checkpoint_id: command.checkpointId,
    p_expected_state_version: command.expectedStateVersion, p_lease_token: command.leaseToken,
    p_resolution: command.resolution, p_next_minute: 60,
    p_simulation_state: command.simulationState, p_next_action_at: command.nextActionAt,
    p_events: [{
      event_key: "goal:53:4", kind: "GOAL", minute: 53, home_score: 1, away_score: 0,
      payload: { scorerName: "Player" }, available_at: "2026-11-18T20:00:53.000Z",
    }],
    p_next_checkpoint: {
      checkpoint_key: "minute-60", kind: "MINUTE_60", minute: 60,
      opened_at: "2026-11-18T20:01:00.000Z",
      decision_deadline_at: "2026-11-18T20:01:05.000Z",
      next_segment_at: "2026-11-18T20:01:05.000Z",
    },
  });
});

test("checkpoint resolution rejects stale lease and malformed RPC responses", async () => {
  const repository = new SupabaseMatchRuntimeCheckpointRepository({ rpc: async () => false } as never);
  await assert.rejects(() => repository.resolveCheckpoint({
    runtimeId: "runtime-1", checkpointId: "checkpoint-45", expectedStateVersion: 1,
    leaseToken: "stale", resolution: {}, nextMinute: 60, simulationState: {},
    nextActionAt: "2026-11-18T20:01:00.000Z", events: [],
    nextCheckpoint: {
      checkpointKey: "minute-60", kind: "MINUTE_60", minute: 60,
      openedAt: "2026-11-18T20:01:00.000Z",
      decisionDeadlineAt: "2026-11-18T20:01:05.000Z",
      nextSegmentAt: "2026-11-18T20:01:05.000Z",
    },
  }), /SUPABASE_MATCH_RUNTIME_CHECKPOINT_REJECTED/);
});
