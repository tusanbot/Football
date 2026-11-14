import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIdempotencyKey,
  assertPositiveAmount,
  calculateNextBalance,
} from "./economy.js";

test("positive amounts must be within the supported limit", () => {
  assert.doesNotThrow(() => assertPositiveAmount(1n));
  assert.throws(() => assertPositiveAmount(0n), /greater than zero/);
  assert.throws(() => assertPositiveAmount(-1n), /greater than zero/);
  assert.throws(() => assertPositiveAmount(9_000_000_000_000_001n), /supported balance limit/);
});

test("credits and debits preserve non-negative bounded balances", () => {
  assert.equal(calculateNextBalance(10n, "CREDIT", 5n), 15n);
  assert.equal(calculateNextBalance(10n, "DEBIT", 5n), 5n);
  assert.throws(() => calculateNextBalance(4n, "DEBIT", 5n), /Insufficient funds/);
  assert.throws(() => calculateNextBalance(-1n, "CREDIT", 1n), /cannot be negative/);
  assert.throws(
    () => calculateNextBalance(9_000_000_000_000_000n, "CREDIT", 1n),
    /Balance limit exceeded/,
  );
});

test("idempotency keys must be bounded and URL-safe", () => {
  assert.doesNotThrow(() => assertIdempotencyKey("starter:123456:CASH"));
  assert.throws(() => assertIdempotencyKey("short"), /Invalid idempotency key/);
  assert.throws(() => assertIdempotencyKey("invalid key with spaces"), /Invalid idempotency key/);
});
