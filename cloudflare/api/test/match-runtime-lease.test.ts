import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMatchRuntimeLeaseRepository } from "../src/repositories/match-runtime-lease.js";

test("match runtime lease repository reads and validates scheduler flags", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return [{
        next_alarm: "2026-11-18T20:00:00.000Z",
        has_due_runtime: true,
        has_due_fixture: false,
        has_due_notifications: true,
        has_pending_tournament_finalization: false,
        has_pending_promotion_work: true,
      }];
    },
  } as never;
  const repository = new SupabaseMatchRuntimeLeaseRepository(client);
  const schedule = await repository.getSchedule();
  assert.equal(calls[0]?.name, "get_match_coordinator_schedule");
  assert.deepEqual(calls[0]?.args, {});
  assert.equal(schedule.nextAlarm?.toISOString(), "2026-11-18T20:00:00.000Z");
  assert.equal(schedule.hasDueRuntime, true);
  assert.equal(schedule.hasDueFixture, false);
  assert.equal(schedule.hasDueNotifications, true);
  assert.equal(schedule.hasPendingTournamentFinalization, false);
  assert.equal(schedule.hasPendingPromotionWork, true);
});

test("match runtime lease repository rejects malformed scheduler results", async () => {
  const repository = new SupabaseMatchRuntimeLeaseRepository({
    rpc: async () => [{ next_alarm: "not-a-date", has_due_runtime: true }],
  } as never);
  await assert.rejects(repository.getSchedule(), /SUPABASE_MATCH_SCHEDULE_INVALID_RESPONSE/);
});

test("match runtime lease claim maps lease tokens and timestamps", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new SupabaseMatchRuntimeLeaseRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{ runtime_id: "runtime-1", lease_token: "lease-1", lease_expires_at: "2026-11-18T20:01:00.000Z" }];
    },
  } as never);
  const leases = await repository.claim({
    workerId: "worker-test", now: "2026-11-18T20:00:00.000Z", leaseMs: 60_000, limit: 10,
  });
  assert.equal(call?.name, "claim_due_match_runtimes");
  assert.deepEqual(call?.args, {
    p_worker_id: "worker-test", p_now: "2026-11-18T20:00:00.000Z", p_lease_ms: 60_000, p_limit: 10,
  });
  assert.deepEqual(leases, [{
    runtime: { id: "runtime-1" },
    lease: { owner: "worker-test", token: "lease-1", expiresAt: new Date("2026-11-18T20:01:00.000Z") },
  }]);
});

test("match runtime lease claim rejects malformed rows", async () => {
  const repository = new SupabaseMatchRuntimeLeaseRepository({
    rpc: async () => [{ runtime_id: "runtime-1", lease_token: "", lease_expires_at: "invalid" }],
  } as never);
  await assert.rejects(() => repository.claim({
    workerId: "worker-test", now: "2026-11-18T20:00:00.000Z", leaseMs: 60_000, limit: 10,
  }), /SUPABASE_MATCH_RUNTIME_CLAIM_INVALID_RESPONSE/);
});

test("match runtime lease release returns the atomic RPC result", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new SupabaseMatchRuntimeLeaseRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{ released: true }];
    },
  } as never);
  const released = await repository.release({
    runtimeId: "runtime-1", leaseToken: "lease-1",
    nextActionAt: "2026-11-18T20:00:05.000Z", lastError: null,
  });
  assert.equal(call?.name, "release_match_runtime_lease");
  assert.deepEqual(call?.args, {
    p_runtime_id: "runtime-1", p_lease_token: "lease-1",
    p_next_action_at: "2026-11-18T20:00:05.000Z", p_last_error: null,
  });
  assert.equal(released, true);
});

test("match runtime lease release rejects malformed RPC results", async () => {
  const repository = new SupabaseMatchRuntimeLeaseRepository({ rpc: async () => [] } as never);
  await assert.rejects(() => repository.release({
    runtimeId: "runtime-1", leaseToken: "lease-1", nextActionAt: null, lastError: null,
  }), /SUPABASE_MATCH_RUNTIME_RELEASE_INVALID_RESPONSE/);
});
