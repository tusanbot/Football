import assert from "node:assert/strict";
import test from "node:test";
import { applyWalletEntry, WalletOperationError } from "../src/economy/wallet-service.js";

test("wallet mutations fail closed when the Supabase transaction port is missing", async () => {
  await assert.rejects(
    applyWalletEntry({
      userId: "user-1", asset: "CASH", direction: "CREDIT", amount: 100n,
      idempotencyKey: "wallet-test-key-0001", reason: "TEST",
    }),
    (error: unknown) => error instanceof WalletOperationError && error.code === "SUPABASE_WALLET_ENTRY_UNAVAILABLE",
  );
});
