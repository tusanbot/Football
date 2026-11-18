import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseWalletEntryRepository } from "../src/repositories/wallet-entry.js";

test("wallet entry repository sends decimal bigint and idempotency data to the atomic RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{ ledger_id: "ledger-1", balance: "1250", version: 4, replayed: false }];
    },
  } as never;
  const repository = new SupabaseWalletEntryRepository(client);
  const result = await repository.applyWalletEntry({
    userId: "user-1",
    asset: "CASH",
    direction: "CREDIT",
    amount: 250n,
    idempotencyKey: "wallet-test-key-0001",
    reason: "TEST_REWARD",
    referenceType: "TEST",
    referenceId: "ref-1",
  });
  assert.equal(call?.name, "apply_wallet_entry");
  assert.equal(call?.args.p_amount, "250");
  assert.equal(result.balance, "1250");
  assert.equal(result.version, 4);
  assert.equal(result.replayed, false);
});

test("wallet entry repository rejects an empty RPC response", async () => {
  const client = { rpc: async () => [] } as never;
  const repository = new SupabaseWalletEntryRepository(client);
  await assert.rejects(() => repository.applyWalletEntry({
    userId: "user-1", asset: "CASH", direction: "DEBIT", amount: 1n,
    idempotencyKey: "wallet-test-key-0002", reason: "TEST",
  }), /SUPABASE_WALLET_RPC_INVALID_RESPONSE/);
});
