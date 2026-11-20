import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseClubMatchReadRepository } from "../src/repositories/club-match-read.js";

const payload = {
  clubId: "club-1",
  matches: [{
    id: "match-1", type: "LEAGUE", status: "IN_PROGRESS", scheduledAt: "2026-11-19T12:00:00.000Z",
    homeClub: { id: "club-1", name: "Home" }, awayClub: { id: "club-2", name: "Away" },
    checkpoints: [], events: [],
  }],
  competitions: [{ id: "competition-1", name: "League", season: 2026, format: "LEAGUE", cupLegs: 1, status: "ACTIVE" }],
};

test("club match read delegates to Supabase RPC and returns its payload", async () => {
  let call: unknown;
  const repo = new SupabaseClubMatchReadRepository({
    rpc: async (name: string, args: unknown) => { call = { name, args }; return payload; },
  } as never);
  const result = await repo.list("user-1");
  assert.equal(result.clubId, "club-1");
  assert.equal(result.matches[0]?.id, "match-1");
  assert.deepEqual(call, { name: "list_club_matches_http", args: { p_user_id: "user-1" } });
});

test("club match read rejects malformed RPC payloads", async () => {
  const repo = new SupabaseClubMatchReadRepository({ rpc: async () => ({ clubId: "club-1", matches: null, competitions: [] }) } as never);
  await assert.rejects(() => repo.list("user-1"), /SUPABASE_CLUB_MATCH_READ_INVALID_RESPONSE/);
});
