import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseSpecialAcquisitionRepository } from "../src/repositories/special-acquisition.js";

test("special acquisition repository calls the atomic RPC and preserves exact gold balance", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{
        acquisition_id: "acquisition-1", player_id: "player-1", method: "epic_pack",
        special_player: { id: "special-1", fullName: "Example Player", rarity: "EPIC", overall: 90 },
        gold_balance: "9007199254740993123", replayed: false,
      }];
    },
  } as never;
  const result = await new SupabaseSpecialAcquisitionRepository(client).acquire({
    userId: "user-1", method: "epic_pack", idempotencyKey: "special-test-0001",
  });
  assert.equal(call?.name, "acquire_special_player");
  assert.equal(call?.args.p_method, "epic_pack");
  assert.equal(result.goldBalance, "9007199254740993123");
  assert.equal(result.specialPlayer.overall, 90);
});

test("special acquisition repository rejects malformed RPC responses", async () => {
  const client = { rpc: async () => [{ acquisition_id: 1 }] } as never;
  await assert.rejects(() => new SupabaseSpecialAcquisitionRepository(client).acquire({
    userId: "user-1", method: "epic_pack", idempotencyKey: "special-test-0002",
  }), /SUPABASE_SPECIAL_ACQUISITION_INVALID_RESPONSE/);
});
