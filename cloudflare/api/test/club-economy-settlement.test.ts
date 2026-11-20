import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseClubEconomySettlementRepository } from "../src/repositories/club-economy-settlement.js";

test("club economy settlement delegates to one atomic RPC and preserves bigint strings", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new SupabaseClubEconomySettlementRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return { elapsedDays: 2, sponsorIncome: "500", operatingCost: "120", paid: "120", arrears: "0" };
    },
  } as never);
  const now = new Date("2026-11-19T12:00:00.000Z");
  const result = await repository.settle("user-1", now);
  assert.deepEqual(call, { name: "settle_club_economy", args: { p_user_id: "user-1", p_now: now.toISOString() } });
  assert.deepEqual(result, { elapsedDays: 2, sponsorIncome: "500", operatingCost: "120", paid: "120", arrears: "0" });
});

test("club economy settlement rejects malformed RPC results", async () => {
  const repository = new SupabaseClubEconomySettlementRepository({ rpc: async () => ({ elapsedDays: "1" }) } as never);
  await assert.rejects(() => repository.settle("user-1", new Date()), /INVALID_RESPONSE/);
});
