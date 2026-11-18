import test from "node:test";
import assert from "node:assert/strict";
import { SupabasePublicPlayerRecordRepository } from "../src/repositories/public-player-records.js";
import type { SupabaseHttpClient } from "../src/supabase-http.js";

test("public player records repository calls the aggregate RPC and maps numeric values", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{
        playerId: "player-1",
        playerName: "Alex Striker",
        position: "ST",
        overall: 88,
        clubName: "Tosan FC",
        appearances: "12",
        goals: 9,
        assists: "3",
        minutesPlayed: "980",
        averageRating: "8.35",
        value: "9",
      }];
    },
  } as unknown as SupabaseHttpClient;
  const repository = new SupabasePublicPlayerRecordRepository(client);
  const records = await repository.list("goals", 10);
  assert.deepEqual(call, { name: "get_public_player_records", args: { p_metric: "goals", p_limit: 10 } });
  assert.deepEqual(records, [{
    playerId: "player-1",
    playerName: "Alex Striker",
    position: "ST",
    overall: 88,
    clubName: "Tosan FC",
    appearances: 12,
    goals: 9,
    assists: 3,
    minutesPlayed: 980,
    averageRating: 8.35,
    value: 9,
  }]);
});

test("public player records repository rejects malformed RPC payloads", async () => {
  const client = {
    rpc: async () => [{ playerId: 42 }],
  } as unknown as SupabaseHttpClient;
  const repository = new SupabasePublicPlayerRecordRepository(client);
  await assert.rejects(repository.list("rating", 20), /SUPABASE_PLAYER_RECORD_INVALID_PLAYER_ID/);
  const invalidRows = new SupabasePublicPlayerRecordRepository({
    rpc: async () => ({ rows: [] }),
  } as unknown as SupabaseHttpClient);
  await assert.rejects(invalidRows.list("goals", 20), /SUPABASE_PLAYER_RECORD_INVALID_RESPONSE/);
});
