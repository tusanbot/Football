import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseSeasonAwardRepository } from "../src/repositories/season-awards.js";
import type { SupabaseHttpClient } from "../src/supabase-http.js";

test("season awards repository loads aggregated and manual awards through one RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return {
        matches: 6,
        records: [{ playerId: "p1", playerName: "Alex", position: "ST", clubName: "Tosan", appearances: "4", goals: "5", assists: 2, minutesPlayed: "360", averageRating: "8.45" }],
        manualAwards: [{ id: "a1", awardType: "FAIR_PLAY", awardName: "Fair Play", reason: null, playerId: "p1", playerName: "Alex", position: "ST", clubName: "Tosan" }],
      };
    },
  } as unknown as SupabaseHttpClient;
  const data = await new SupabaseSeasonAwardRepository(client).getSeasonData(2026);
  assert.deepEqual(call, { name: "get_season_award_data", args: { p_season: 2026 } });
  assert.deepEqual(data, {
    matches: 6,
    records: [{ playerId: "p1", playerName: "Alex", position: "ST", clubName: "Tosan", appearances: 4, goals: 5, assists: 2, minutesPlayed: 360, averageRating: 8.45 }],
    manualAwards: [{ id: "a1", awardType: "FAIR_PLAY", awardName: "Fair Play", reason: null, playerId: "p1", playerName: "Alex", position: "ST", clubName: "Tosan" }],
  });
});

test("season awards repository rejects malformed RPC payloads", async () => {
  const client = { rpc: async () => ({ matches: "bad", records: [], manualAwards: [] }) } as unknown as SupabaseHttpClient;
  await assert.rejects(new SupabaseSeasonAwardRepository(client).getSeasonData(2026), /SUPABASE_SEASON_AWARDS_INVALID_MATCHES/);
});
