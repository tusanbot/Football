import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseCompetitionCreationRepository } from "../src/repositories/competition-creation.js";

const competition = {
  id: "competition_123", idempotencyKey: "league:create:123456", name: "Test League",
  season: 2026, format: "LEAGUE", status: "REGISTRATION", maxTeams: 8, cupLegs: 1,
  rules: { penaltiesOnDraw: false }, createdByClubId: "club-1", groupId: null,
  allianceId: null, allianceSeasonId: null, startsAt: null, completedAt: null,
  createdAt: "2026-11-19T08:00:00.000Z", updatedAt: "2026-11-19T08:00:00.000Z",
};
const input = {
  userId: "user-1", name: "Test League", maxTeams: 8, idempotencyKey: "league:create:123456",
  format: "LEAGUE" as const, cupLegs: 1, season: 2026,
  rules: { maxSubstitutions: 5, maxInPlayWindows: 3, injuriesEnabled: true, injuryDurationDays: 5,
    redCardSuspensionMatches: 1, yellowCardsToSuspend: 3, yellowCardSuspensionMatches: 1, penaltiesOnDraw: false },
  now: new Date("2026-11-19T08:00:00.000Z"),
};

test("competition creation delegates atomic create and idempotent replay to Supabase RPC", async () => {
  let call: unknown;
  const repo = new SupabaseCompetitionCreationRepository({
    rpc: async (name: string, args: unknown) => { call = { name, args }; return { competition, replayed: true }; },
  } as never);
  const result = await repo.create(input);
  assert.equal(result.replayed, true);
  assert.equal((result.competition as typeof competition).id, competition.id);
  assert.deepEqual(call, {
    name: "create_competition_http",
    args: {
      p_user_id: input.userId, p_name: input.name, p_max_teams: input.maxTeams,
      p_idempotency_key: input.idempotencyKey, p_format: input.format,
      p_cup_legs: input.cupLegs, p_season: input.season, p_rules: input.rules,
      p_now: input.now.toISOString(),
    },
  });
});

test("competition repository rejects malformed RPC responses", async () => {
  const repo = new SupabaseCompetitionCreationRepository({
    rpc: async () => ({ competition: { id: "broken" }, replayed: false }),
  } as never);
  await assert.rejects(() => repo.create(input), /SUPABASE_COMPETITION_CREATION_INVALID_RESPONSE/);
});
