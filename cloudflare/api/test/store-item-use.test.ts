import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseStoreItemUseRepository } from "../src/repositories/store-item-use.js";

test("store item use repository calls the atomic RPC and maps updated player stats", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{ item_key: "recovery_kit", player_id: "player-1", inventory: 2, fitness: 88, morale: 72, replayed: false }];
    },
  } as never;
  const result = await new SupabaseStoreItemUseRepository(client).use({
    userId: "user-1", itemKey: "recovery_kit", playerId: "player-1",
    fitnessDelta: 35, moraleDelta: 0, idempotencyKey: "store-use-0001",
  });
  assert.equal(call?.name, "use_store_item");
  assert.equal(call?.args.p_fitness_delta, 35);
  assert.deepEqual(result.player, { fitness: 88, morale: 72 });
  assert.equal(result.inventory, 2);
  assert.equal(result.replayed, false);
});

test("store item use repository accepts replay responses without player stats", async () => {
  const client = {
    rpc: async () => [{ item_key: "recovery_kit", player_id: "player-1", inventory: 1, fitness: null, morale: null, replayed: true }],
  } as never;
  const result = await new SupabaseStoreItemUseRepository(client).use({
    userId: "user-1", itemKey: "recovery_kit", playerId: "player-1",
    fitnessDelta: 35, moraleDelta: 0, idempotencyKey: "store-use-0002",
  });
  assert.equal(result.replayed, true);
  assert.equal(result.player, undefined);
});
