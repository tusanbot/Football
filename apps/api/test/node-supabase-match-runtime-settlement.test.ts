import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMatchRuntimeSettlementRepository } from "../src/game/node-supabase-match-runtime-settlement.js";
import { SupabaseCompetitionAdvancementRepository } from "../src/game/node-supabase-competition-advancement.js";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";

function stubFetch(payload: unknown, status = 200) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const url = "https://example.supabase.co";
const key = "match-runtime-service-role-test-key";

test("match runtime settlement delegates the complete financial and match result to one authenticated RPC", async () => {
  const result = {
    matchId: "match-1", replayed: false, competitionId: "competition-1", round: 2,
    homeClub: "Home", awayClub: "Away", homeScore: 2, awayScore: 1,
    homePenalties: null, awayPenalties: null, winnerClubId: "club-home",
    attendance: 1200, ticketRevenue: "60000", events: [],
  };
  const stub = stubFetch(result);
  try {
    const repository = new SupabaseMatchRuntimeSettlementRepository(
      new SupabaseHttpClient({ url, serviceRoleKey: key }),
    );
    const settled = await repository.settle({
      matchId: "match-1", runtimeId: "runtime-1", leaseToken: "lease-secret",
      now: "2026-11-20T10:00:00.000Z", result: { homeScore: 2, awayScore: 1 },
      injuryDurationDays: 7, redCardSuspensionMatches: 2,
      yellowCardsToSuspend: 3, yellowCardSuspensionMatches: 1,
      homeReward: "250", awayReward: "100",
    });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0]!.url, url + "/rest/v1/rpc/settle_and_advance_match_runtime_http");
    assert.equal(stub.calls[0]!.headers.get("authorization"), "Bearer " + key);
    assert.deepEqual(stub.calls[0]!.body, {
      p_match_id: "match-1", p_runtime_id: "runtime-1", p_lease_token: "lease-secret",
      p_now: "2026-11-20T10:00:00.000Z", p_result: { homeScore: 2, awayScore: 1 },
      p_injury_duration_days: 7, p_red_card_suspension_matches: 2,
      p_yellow_cards_to_suspend: 3, p_yellow_card_suspension_matches: 1,
      p_home_reward: "250", p_away_reward: "100",
    });
    assert.deepEqual(settled, result);
  } finally { stub.restore(); }
});

test("match runtime settlement rejects malformed RPC responses and preserves SQL business errors", async () => {
  const malformed = stubFetch([{ matchId: "match-1" }]);
  try {
    const repository = new SupabaseMatchRuntimeSettlementRepository(new SupabaseHttpClient({ url, serviceRoleKey: key }));
    await assert.rejects(repository.settle({
      matchId: "match-1", runtimeId: "runtime-1", leaseToken: "lease-secret",
      now: "2026-11-20T10:00:00.000Z", result: {}, injuryDurationDays: 7,
      redCardSuspensionMatches: 2, yellowCardsToSuspend: 3,
      yellowCardSuspensionMatches: 1, homeReward: "250", awayReward: "100",
    }), /SUPABASE_MATCH_RUNTIME_SETTLEMENT_REJECTED/);
  } finally { malformed.restore(); }

  const failed = stubFetch({ message: "MATCH_RUNTIME_LEASE_LOST", code: "P0001" }, 400);
  try {
    const repository = new SupabaseMatchRuntimeSettlementRepository(new SupabaseHttpClient({ url, serviceRoleKey: key }));
    await assert.rejects(repository.settle({
      matchId: "match-1", runtimeId: "runtime-1", leaseToken: "lease-secret",
      now: "2026-11-20T10:00:00.000Z", result: {}, injuryDurationDays: 7,
      redCardSuspensionMatches: 2, yellowCardsToSuspend: 3,
      yellowCardSuspensionMatches: 1, homeReward: "250", awayReward: "100",
    }), (error: unknown) => error instanceof Error && error.message === "MATCH_RUNTIME_LEASE_LOST");
  } finally { failed.restore(); }
});

test("competition advancement uses the atomic Supabase RPC and validates its result", async () => {
  const result = {
    competitionId: "competition-1", format: "CUP" as const, completed: false,
    roundComplete: true, nextRound: 3, fixturesCreated: 2, noticesCreated: 0, replayed: false,
  };
  const stub = stubFetch(result);
  try {
    const repository = new SupabaseCompetitionAdvancementRepository(new SupabaseHttpClient({ url, serviceRoleKey: key }));
    assert.deepEqual(await repository.advance({
      competitionId: "competition-1", round: 2, now: "2026-11-20T10:00:00.000Z",
    }), result);
    assert.equal(stub.calls[0]!.url, url + "/rest/v1/rpc/advance_competition_after_match_http");
    assert.deepEqual(stub.calls[0]!.body, {
      p_competition_id: "competition-1", p_round: 2, p_now: "2026-11-20T10:00:00.000Z",
    });
  } finally { stub.restore(); }

  const malformed = stubFetch([{ competitionId: "other", format: "CUP" }]);
  try {
    const repository = new SupabaseCompetitionAdvancementRepository(new SupabaseHttpClient({ url, serviceRoleKey: key }));
    await assert.rejects(repository.advance({
      competitionId: "competition-1", round: 2, now: "2026-11-20T10:00:00.000Z",
    }), /SUPABASE_COMPETITION_ADVANCEMENT_REJECTED/);
  } finally { malformed.restore(); }
});
