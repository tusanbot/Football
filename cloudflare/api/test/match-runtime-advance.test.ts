import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMatchRuntimeAdvanceRepository } from "../src/repositories/match-runtime-advance.js";

test("first-half transition maps event payloads to the SQL RPC contract", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new SupabaseMatchRuntimeAdvanceRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return true;
    },
  } as never);
  const command = {
    runtimeId: "runtime-1", expectedStateVersion: 7, leaseToken: "lease-token",
    simulationState: { segment: { currentMinute: 45 }, substitutions: {} },
    startedAt: "2026-11-18T20:00:00.000Z",
    checkpointAt: "2026-11-18T20:00:45.000Z",
    decisionDeadlineAt: "2026-11-18T20:00:50.000Z",
    events: [{
      eventKey: "kickoff", kind: "KICKOFF", minute: 0, homeScore: 0, awayScore: 0,
      payload: null, availableAt: "2026-11-18T20:00:00.000Z",
    }],
  };
  assert.equal(await repository.advanceFirstHalf(command), true);
  assert.equal(call?.name, "advance_match_runtime_first_half");
  assert.deepEqual(call?.args, {
    p_runtime_id: command.runtimeId,
    p_expected_state_version: command.expectedStateVersion,
    p_lease_token: command.leaseToken,
    p_simulation_state: command.simulationState,
    p_started_at: command.startedAt,
    p_checkpoint_at: command.checkpointAt,
    p_decision_deadline_at: command.decisionDeadlineAt,
    p_events: [{
      event_key: "kickoff", kind: "KICKOFF", minute: 0, home_score: 0, away_score: 0,
      payload: null, available_at: "2026-11-18T20:00:00.000Z",
    }],
  });
});

test("first-half transition rejects stale lease and malformed RPC responses", async () => {
  const repository = new SupabaseMatchRuntimeAdvanceRepository({ rpc: async () => false } as never);
  await assert.rejects(() => repository.advanceFirstHalf({
    runtimeId: "runtime-1", expectedStateVersion: 1, leaseToken: "stale",
    simulationState: {}, startedAt: "2026-11-18T20:00:00.000Z",
    checkpointAt: "2026-11-18T20:00:45.000Z",
    decisionDeadlineAt: "2026-11-18T20:00:50.000Z", events: [],
  }), /SUPABASE_MATCH_RUNTIME_FIRST_HALF_REJECTED/);
});
