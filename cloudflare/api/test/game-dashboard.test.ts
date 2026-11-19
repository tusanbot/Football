import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseGameDashboardRepository } from "../src/repositories/game-dashboard.js";

test("game dashboard repository calls the read-only Supabase RPC with the authenticated user id", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const expected = {
    user: { id: "user-1", telegramId: "12345", username: null, displayName: "Player", createdAt: "2026-11-18T12:00:00.000Z" },
    club: { id: "club-1", name: "Player FC", level: 1, reputation: 0, createdAt: "2026-11-18T12:00:00.000Z", activeCompetition: null },
    wallets: [{ asset: "CASH", balance: "20000", version: 0 }],
  };
  const repository = new SupabaseGameDashboardRepository({
    rpc: async (name: string, args: Record<string, unknown>) => { call = { name, args }; return expected; },
  } as never);
  assert.deepEqual(await repository.getDashboard("user-1"), expected);
  assert.deepEqual(call, { name: "get_game_dashboard", args: { p_user_id: "user-1" } });
});

test("game dashboard repository rejects an incomplete RPC payload", async () => {
  const repository = new SupabaseGameDashboardRepository({ rpc: async () => ({ user: null, wallets: [] }) } as never);
  await assert.rejects(() => repository.getDashboard("user-1"), /SUPABASE_GAME_DASHBOARD_INVALID_RESPONSE/);
});
