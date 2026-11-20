import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMatchRuntimeForfeitRepository } from "../src/game/node-supabase-match-runtime-forfeit.js";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";

function stubFetch(payload: unknown) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("invalid-lineup forfeit uses one RPC that also advances its competition", async () => {
  const payload = {
    settled: true, replayed: false, matchId: "match-1",
    competitionId: "competition-1", round: 2, competitionFormat: "CUP",
    pyramidFinalization: { processed: false, replayed: true },
    eventTournamentFinalization: { finalized: false, replayed: true, participants: 0, awards: 0 },
    advancement: {
      competitionId: "competition-1", format: "CUP", completed: false,
      roundComplete: true, nextRound: 3, fixturesCreated: 2, noticesCreated: 0, replayed: false,
    },
  };
  const stub = stubFetch(payload);
  try {
    const repository = new SupabaseMatchRuntimeForfeitRepository(
      new SupabaseHttpClient({ url: "https://example.supabase.co", serviceRoleKey: "test-service-role-key" }),
    );
    const result = await repository.forfeit("match-1", "2026-11-20T10:00:00.000Z");
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0]!.url, "https://example.supabase.co/rest/v1/rpc/settle_invalid_match_fixture_and_advance_http");
    assert.deepEqual(stub.calls[0]!.body, { p_match_id: "match-1", p_now: "2026-11-20T10:00:00.000Z" });
    assert.deepEqual(result, payload);
  } finally {
    stub.restore();
  }
});

test("invalid-lineup forfeit rejects a completed competition settlement without its advancement result", async () => {
  const stub = stubFetch({
    settled: true, replayed: false, matchId: "match-1",
    competitionId: "competition-1", round: 2, competitionFormat: "CUP", advancement: null, pyramidFinalization: null, eventTournamentFinalization: null,
  });
  try {
    const repository = new SupabaseMatchRuntimeForfeitRepository(
      new SupabaseHttpClient({ url: "https://example.supabase.co", serviceRoleKey: "test-service-role-key" }),
    );
    await assert.rejects(repository.forfeit("match-1", "2026-11-20T10:00:00.000Z"),
      /SUPABASE_MATCH_RUNTIME_FORFEIT_ADVANCEMENT_INVALID_RESPONSE/);
  } finally {
    stub.restore();
  }
});
