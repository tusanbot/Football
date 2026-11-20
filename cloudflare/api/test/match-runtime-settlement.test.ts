import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMatchRuntimeSettlementRepository } from "../src/repositories/match-runtime-settlement.js";

test("runtime settlement is sent as one atomic Supabase RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const expected = {
    replayed: false, matchId: "match-1", competitionId: null, round: null,
    homeClub: "Home", awayClub: "Away", homeScore: 2, awayScore: 1,
    homePenalties: null, awayPenalties: null, winnerClubId: "club-home",
    attendance: 1200, ticketRevenue: "60000", events: [],
  };
  const repository = new SupabaseMatchRuntimeSettlementRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return expected;
    },
  } as never);
  const command = {
    matchId: "match-1", runtimeId: "runtime-1", leaseToken: "lease-token",
    now: "2026-11-18T20:10:00.000Z", result: { homeScore: 2, awayScore: 1, events: [], performances: [] },
    injuryDurationDays: 7, redCardSuspensionMatches: 1, yellowCardsToSuspend: 3,
    yellowCardSuspensionMatches: 1, homeReward: "250", awayReward: "100",
  };
  assert.deepEqual(await repository.settle(command), expected);
  assert.deepEqual(call, {
    name: "settle_match_runtime_result",
    args: {
      p_match_id: command.matchId, p_runtime_id: command.runtimeId, p_lease_token: command.leaseToken,
      p_now: command.now, p_result: command.result,
      p_injury_duration_days: 7, p_red_card_suspension_matches: 1,
      p_yellow_cards_to_suspend: 3, p_yellow_card_suspension_matches: 1,
      p_home_reward: "250", p_away_reward: "100",
    },
  });
});

test("runtime settlement rejects malformed RPC results", async () => {
  const repository = new SupabaseMatchRuntimeSettlementRepository({ rpc: async () => null } as never);
  await assert.rejects(() => repository.settle({
    matchId: "match-1", runtimeId: "runtime-1", leaseToken: "lease-token",
    now: "2026-11-18T20:10:00.000Z", result: {},
    injuryDurationDays: 7, redCardSuspensionMatches: 1, yellowCardsToSuspend: 3,
    yellowCardSuspensionMatches: 1, homeReward: "250", awayReward: "100",
  }), /SUPABASE_MATCH_RUNTIME_SETTLEMENT_REJECTED/);
});
