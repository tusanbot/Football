import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseSpecialPlayerCatalogRepository } from "../src/repositories/special-player-catalog.js";

test("special player catalog reads active records through the Supabase RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const rows = [{ id: "special-1", slug: "legend", rarity: "LEGENDARY", overall: 95 }];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { call = { name, args }; return rows; } } as never;
  const result = await new SupabaseSpecialPlayerCatalogRepository(client).listActive();
  assert.deepEqual(call, { name: "get_active_special_players", args: {} });
  assert.deepEqual(result, rows);
});

test("special player catalog rejects malformed RPC payloads", async () => {
  const client = { rpc: async () => ({ id: "not-an-array" }) } as never;
  await assert.rejects(() => new SupabaseSpecialPlayerCatalogRepository(client).listActive(), /SUPABASE_SPECIAL_PLAYER_CATALOG_INVALID_RESPONSE/);
});
