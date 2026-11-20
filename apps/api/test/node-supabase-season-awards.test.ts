import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseSeasonAwardRepository } from "../src/game/node-supabase-season-awards.js";

test("season award repository validates and maps the RPC response", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new NodeSupabaseSeasonAwardRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return {
        matches: "12",
        records: [{
          playerId: "player-1", playerName: "Test Player", position: "ST", clubName: "Test FC",
          appearances: "10", goals: 8, assists: 3, minutesPlayed: 850, averageRating: "7.4",
        }],
        manualAwards: [{
          id: "award-1", awardType: "FAIR_PLAY", awardName: "Fair Play", reason: null,
          playerId: "player-1", playerName: "Test Player", position: "ST", clubName: "Test FC",
        }],
      };
    },
  } as never);
  const data = await repository.getSeasonData(2026);
  assert.equal(call?.name, "get_season_award_data");
  assert.deepEqual(call?.args, { p_season: 2026 });
  assert.equal(data.matches, 12);
  assert.equal(data.records[0]?.goals, 8);
  assert.equal(data.records[0]?.averageRating, 7.4);
  assert.equal(data.manualAwards[0]?.reason, null);
});

test("season award repository rejects malformed RPC responses", async () => {
  const repository = new NodeSupabaseSeasonAwardRepository({ rpc: async () => ({ records: [], manualAwards: [] }) } as never);
  await assert.rejects(() => repository.getSeasonData(2026), /INVALID_MATCHES/);
});
