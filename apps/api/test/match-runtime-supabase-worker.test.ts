import assert from "node:assert/strict";
import test from "node:test";
import { processDueMatchRuntimes } from "../src/game/match-service.js";
import { withMatchRuntimeEnqueuePort } from "../src/game/match-runtime-enqueue-context.js";
import { withMatchRuntimeLeasePort } from "../src/game/match-runtime-lease-context.js";
import { withMatchRuntimeSnapshotPort } from "../src/game/match-runtime-snapshot-context.js";
import { withMatchRuntimeForfeitPort } from "../src/game/match-runtime-forfeit-context.js";

async function withTestEnvironment<T>(operation: () => Promise<T>): Promise<T> {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnvironment = process.env.ENVIRONMENT;
  process.env.NODE_ENV = "test";
  delete process.env.ENVIRONMENT;
  try { return await operation(); }
  finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
  }
}

test("match worker coordinator delegates enqueue, lease claim and runtime lookup to scoped Supabase ports", async () => {
  await withTestEnvironment(async () => {
    const calls: string[] = [];
    const now = new Date("2026-11-20T12:00:00.000Z");
    const result = await withMatchRuntimeEnqueuePort({
      async enqueue(at, limit) {
        calls.push("enqueue");
        assert.equal(at, now.toISOString());
        assert.equal(limit, 10);
        return { enqueued: 2, invalidFixtures: [] };
      },
    }, () => withMatchRuntimeLeasePort({
      async claim(input) {
        calls.push("claim");
        assert.equal(input.workerId, "supabase-worker-test");
        assert.equal(input.now, now.toISOString());
        assert.equal(input.leaseMs, 60_000);
        assert.equal(input.limit, 3);
        return [{
          runtime: { id: "runtime-through-supabase" },
          lease: { owner: input.workerId, token: "lease-through-supabase", expiresAt: new Date(now.getTime() + 60_000) },
        }];
      },
      async release() {
        calls.push("release");
        return true;
      },
    }, () => withMatchRuntimeSnapshotPort({
      async get(runtimeId) {
        calls.push("snapshot");
        assert.equal(runtimeId, "runtime-through-supabase");
        // A missing runtime is treated as already settled/deleted; no Prisma lookup is attempted.
        return null;
      },
    }, () => processDueMatchRuntimes("supabase-worker-test", now, 3))));

    assert.deepEqual(calls, ["enqueue", "claim", "snapshot"]);
    assert.deepEqual(result, { enqueued: 2, claimed: 1, advanced: 0, waiting: 0, settled: 1, failed: 0 });
  });
});

test("match worker routes invalid kickoff snapshots to the Supabase forfeit port instead of legacy simulation", async () => {
  await withTestEnvironment(async () => {
    const calls: string[] = [];
    const now = new Date("2026-11-20T12:00:00.000Z");
    const result = await withMatchRuntimeEnqueuePort({
      async enqueue() {
        calls.push("enqueue");
        return { enqueued: 0, invalidFixtures: [{ id: "invalid-match", ownerId: "club-owner" }] };
      },
    }, () => withMatchRuntimeForfeitPort({
      async forfeit(matchId, at) {
        calls.push("forfeit");
        assert.equal(matchId, "invalid-match");
        assert.equal(at, now.toISOString());
        return {
          settled: true, replayed: false, matchId, competitionId: null, round: null,
          competitionFormat: null, advancement: null, pyramidFinalization: null, eventTournamentFinalization: null,
        };
      },
    }, () => processDueMatchRuntimes("supabase-worker-test", now, 3, { claim: false })));

    assert.deepEqual(calls, ["enqueue", "forfeit"]);
    assert.deepEqual(result, { enqueued: 0, claimed: 0, advanced: 0, waiting: 0, settled: 0, failed: 0 });
  });
});
