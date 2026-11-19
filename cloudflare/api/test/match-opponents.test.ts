import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMatchOpponentRepository } from "../src/repositories/match-opponents.js";

test("match opponent repository forwards identity and normalized search to Supabase RPC", async () => {
  let call: unknown;
  const rows = [{
    id: "club-2", name: "Rivals", level: 4, reputation: 120,
    ownerTelegramId: "123456", ownerUsername: "rival",
    lastActiveAt: "2026-11-19T05:00:00.000Z",
  }];
  const repo = new SupabaseMatchOpponentRepository({
    rpc: async (name: string, args: unknown) => { call = { name, args }; return rows; },
  } as never);
  assert.deepEqual(await repo.list("user-1", "  @rival  "), rows);
  assert.deepEqual(call, {
    name: "list_match_opponents_http",
    args: { p_user_id: "user-1", p_search: "@rival" },
  });
});

test("match opponent repository rejects malformed Supabase payloads", async () => {
  const repo = new SupabaseMatchOpponentRepository({
    rpc: async () => [{ id: "club-2", name: "Rivals" }],
  } as never);
  await assert.rejects(() => repo.list("user-1"), /SUPABASE_MATCH_OPPONENTS_INVALID_RESPONSE/);
});
