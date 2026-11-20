import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseStoreSnapshotRepository } from "../src/repositories/store-snapshot.js";

test("store snapshot repository reads wallet, inventory, and special-player catalog in one RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    call = { name, args };
    return { wallets: [{ asset: "CASH", balance: "1000" }], inventory: [], specialPlayers: [] };
  } } as never;
  const result = await new SupabaseStoreSnapshotRepository(client).get("user-1");
  assert.deepEqual(call, { name: "get_store_snapshot", args: { p_user_id: "user-1" } });
  assert.equal(result.wallets[0]?.balance, "1000");
  assert.deepEqual(result.inventory, []);
  assert.deepEqual(result.specialPlayers, []);
});

test("store snapshot repository rejects malformed RPC responses", async () => {
  const client = { rpc: async () => ({ wallets: [], inventory: null, specialPlayers: [] }) } as never;
  await assert.rejects(() => new SupabaseStoreSnapshotRepository(client).get("user-1"), /INVALID_RESPONSE/);
});
