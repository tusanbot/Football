import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseFriendlyMatchCreationRepository } from "../src/repositories/friendly-match-creation.js";

const match = {
  id: "match_123", idempotencyKey: "friendly:key:123456", type: "FRIENDLY", status: "SCHEDULED",
  homeClubId: "club-home", awayClubId: "club-away", competitionId: null, rulesSnapshot: {},
  tieId: null, leg: 1, round: null, scheduledAt: "2026-11-20T12:00:00.000Z", startedAt: null,
  completedAt: null, seed: "seed", simulationVersion: 1, homeScore: null, awayScore: null,
  homePenalties: null, awayPenalties: null, winnerClubId: null, attendance: 0, ticketRevenue: "0",
  homeExpectedGoals: null, awayExpectedGoals: null, createdAt: "2026-11-19T08:00:00.000Z",
  updatedAt: "2026-11-19T08:00:00.000Z",
};

test("friendly match repository delegates atomic creation to Supabase and validates the result", async () => {
  let call: unknown;
  const repo = new SupabaseFriendlyMatchCreationRepository({
    rpc: async (name: string, args: unknown) => { call = { name, args }; return { match, replayed: false }; },
  } as never);
  const result = await repo.create("user-1", "club-away", "friendly:key:123456", new Date(match.scheduledAt));
  assert.equal(result.replayed, false);
  assert.equal(result.match.id, match.id);
  assert.deepEqual(call, {
    name: "create_friendly_match_http",
    args: {
      p_user_id: "user-1", p_opponent_club_id: "club-away",
      p_idempotency_key: "friendly:key:123456", p_scheduled_at: match.scheduledAt,
    },
  });
});

test("friendly match repository rejects malformed RPC results", async () => {
  const repo = new SupabaseFriendlyMatchCreationRepository({
    rpc: async () => ({ match: { id: "broken" }, replayed: false }),
  } as never);
  await assert.rejects(
    () => repo.create("user-1", "club-away", "friendly:key:123456", new Date()),
    /SUPABASE_FRIENDLY_MATCH_INVALID_RESPONSE/,
  );
});
