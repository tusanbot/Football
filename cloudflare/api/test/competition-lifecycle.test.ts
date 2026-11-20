import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseCompetitionCreationRepository } from "../src/repositories/competition-creation.js";
const now = new Date("2026-11-19T12:34:56.789Z");
test("competition join calls the atomic Supabase lifecycle RPC", async () => {
  let call: unknown;
  const repo = new SupabaseCompetitionCreationRepository({ rpc: async (name: string, args: unknown) => {
    call = { name, args };
    return { joined: true, replayed: false, teams: 4, autoStarted: true, fixturesCreated: 6, rounds: 3, startsAt: "2026-11-20T09:00:00.000Z" };
  } } as never);
  const result = await repo.join("user-1", "competition-1", now) as Record<string, unknown>;
  assert.equal(result.autoStarted, true);
  assert.deepEqual(call, { name: "join_competition_http", args: { p_user_id: "user-1", p_competition_id: "competition-1", p_now: now.toISOString() } });
});
test("competition start calls the atomic Supabase lifecycle RPC", async () => {
  let call: unknown;
  const repo = new SupabaseCompetitionCreationRepository({ rpc: async (name: string, args: unknown) => {
    call = { name, args };
    return { fixturesCreated: 4, rounds: 2, teams: 4, cupLegs: 2, replayed: false };
  } } as never);
  const result = await repo.start("user-1", "competition-2", now) as Record<string, unknown>;
  assert.equal(result.fixturesCreated, 4);
  assert.deepEqual(call, { name: "start_competition_http", args: { p_user_id: "user-1", p_competition_id: "competition-2", p_now: now.toISOString() } });
});
test("competition lifecycle repository rejects malformed RPC responses", async () => {
  const repo = new SupabaseCompetitionCreationRepository({ rpc: async () => ({ joined: true }) } as never);
  await assert.rejects(() => repo.join("user-1", "competition-1", now), /SUPABASE_COMPETITION_LIFECYCLE_INVALID_RESPONSE/);
});

test("competition rules update calls the owner-checked Supabase RPC", async () => {
  const rules = { maxSubstitutions: 4, maxInPlayWindows: 2, injuriesEnabled: true, injuryDurationDays: 6, redCardSuspensionMatches: 2, yellowCardsToSuspend: 4, yellowCardSuspensionMatches: 2, penaltiesOnDraw: false };
  let call: unknown;
  const repo = new SupabaseCompetitionCreationRepository({ rpc: async (name: string, args: unknown) => { call = { name, args }; return { competitionId: "competition-rules-1", rules }; } } as never);
  const result = await repo.updateRules("user-1", "competition-rules-1", rules, now) as Record<string, unknown>;
  assert.deepEqual(result, { competitionId: "competition-rules-1", rules });
  assert.deepEqual(call, { name: "update_competition_rules_http", args: { p_user_id: "user-1", p_competition_id: "competition-rules-1", p_rules: rules, p_now: now.toISOString() } });
});
test("competition rules update rejects malformed RPC responses", async () => {
  const repo = new SupabaseCompetitionCreationRepository({ rpc: async () => ({ competitionId: "wrong", rules: {} }) } as never);
  await assert.rejects(() => repo.updateRules("user-1", "competition-1", { penaltiesOnDraw: false }, now), /SUPABASE_COMPETITION_RULES_INVALID_RESPONSE/);
});
