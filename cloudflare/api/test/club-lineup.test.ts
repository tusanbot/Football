import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseClubLineupRepository } from "../src/repositories/club-lineup.js";

test("lineup repository reads only the owning club and its active selected players", async () => {
  const calls: unknown[] = [];
  const client = {
    select: async (table: string, query: unknown) => {
      calls.push({ table, query });
      return table === "Club" ? [{ id: "club-1", name: "Tosan", formation: "4-3-3", mentality: "BALANCED", pressing: "MID_BLOCK", tempo: "NORMAL", passingStyle: "MIXED", lineupVersion: 3 }]
        : [{ id: "p1", lineupSlot: 1 }];
    },
  };
  const result = await new SupabaseClubLineupRepository(client as never).get("user-1");
  assert.deepEqual((result as { club: { lineupVersion: number; players: unknown[] } }).club, {
    id: "club-1", name: "Tosan", formation: "4-3-3",
    tactics: { mentality: "BALANCED", pressing: "MID_BLOCK", tempo: "NORMAL", passingStyle: "MIXED" },
    lineupVersion: 3, players: [{ id: "p1", lineupSlot: 1 }],
  });
  assert.deepEqual(calls.map((call) => (call as { table: string }).table), ["Club", "Player"]);
  assert.equal((calls[0] as { query: { ownerId: string } }).query.ownerId, "eq.user-1");
});

test("lineup repository forwards optimistic version and tactics to atomic RPC", async () => {
  let call: unknown;
  const repo = new SupabaseClubLineupRepository({ rpc: async (name: string, args: unknown) => { call = { name, args }; return { ok: true, lineupVersion: 8 }; } } as never);
  const input = { formation: "4-4-2" as const, playerIds: Array.from({ length: 11 }, (_, i) => "player-" + i), expectedVersion: 7, tactics: { mentality: "ATTACKING" as const } };
  const result = await repo.update("user-2", input);
  assert.deepEqual(call, { name: "update_club_lineup_http", args: {
    p_user_id: "user-2", p_formation: "4-4-2", p_player_ids: input.playerIds, p_expected_version: 7, p_tactics: input.tactics,
  } });
  assert.deepEqual(result, { ok: true, lineupVersion: 8 });
});
