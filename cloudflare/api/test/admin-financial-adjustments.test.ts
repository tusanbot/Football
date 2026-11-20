import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminFinancialAdjustmentsRepository } from "../src/repositories/admin-financial-adjustments.js";

test("Cloudflare admin wallet adjustment reuses the existing atomic Supabase RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    call = { name, args };
    return { ok: true, targetType: "wallet", targetId: "user-1", replay: false, balance: "150", ledgerId: "ledger-1" };
  } } as never;
  const repository = new SupabaseAdminFinancialAdjustmentsRepository(client);
  const result = await repository.execute({
    action: "adjust-wallet", targetId: "user-1", amount: "50", asset: "CASH",
    actorTelegramId: "123456", idempotencyKey: "admin-wallet-key-01", reason: "Manual credit",
  });
  assert.equal(call?.name, "admin_financial_adjustment_http");
  assert.equal(call?.args.p_asset, "CASH");
  assert.equal(result.balance, "150");
});

test("Cloudflare admin group-point adjustment calls the same RPC without an asset", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    call = { name, args };
    return { ok: true, targetType: "group-points", targetId: "group-1", replay: true, points: "125" };
  } } as never;
  const repository = new SupabaseAdminFinancialAdjustmentsRepository(client);
  const result = await repository.execute({
    action: "adjust-group-points", targetId: "group-1", amount: "25",
    actorTelegramId: "123456", idempotencyKey: "admin-group-key-01", reason: "Manual points",
  });
  assert.equal(call?.name, "admin_financial_adjustment_http");
  assert.equal(call?.args.p_asset, null);
  assert.equal(result.points, "125");
  assert.equal(result.replay, true);
});

test("Cloudflare admin financial adapter rejects malformed input and RPC responses", async () => {
  const invalid = new SupabaseAdminFinancialAdjustmentsRepository({ rpc: async () => ({ ok: false }) } as never);
  await assert.rejects(() => invalid.execute({
    action: "adjust-wallet", targetId: "user-1", amount: "0", asset: "CASH",
    actorTelegramId: "123456", idempotencyKey: "admin-wallet-key-02", reason: "Invalid",
  }), /INVALID_ADMIN_FINANCIAL_ADJUSTMENT/);
  await assert.rejects(() => invalid.execute({
    action: "adjust-group-points", targetId: "group-1", amount: "5",
    actorTelegramId: "123456", idempotencyKey: "admin-group-key-02", reason: "Manual points",
  }), /SUPABASE_ADMIN_FINANCIAL_ADJUSTMENT_INVALID_RESPONSE/);
});
