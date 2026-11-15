import test from "node:test";
import assert from "node:assert/strict";
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  WalletLedgerRepository,
  WalletNotFoundError,
  type WalletLedgerD1Database
} from "../src/repositories/wallet-ledger.js";

interface MockStatement {
  sql: string;
  values: unknown[];
  bind(...values: unknown[]): MockStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

function mockDb(options: {
  batchError?: Error;
  existing?: Record<string, unknown> | null;
  wallet?: Record<string, unknown> | null;
} = {}) {
  const statements: MockStatement[] = [];
  const db: WalletLedgerD1Database = {
    prepare(sql: string) {
      const statement: MockStatement = {
        sql,
        values: [],
        bind(...values: unknown[]) {
          this.values = values;
          return this;
        },
        async first<T>() {
          if (sql.includes('FROM "LedgerTransaction"')) return (options.existing ?? null) as T | null;
          if (sql.includes('FROM "Wallet"')) return (options.wallet ?? null) as T | null;
          return null;
        }
      };
      return statement;
    },
    async batch(batchStatements) {
      statements.push(...batchStatements as unknown as MockStatement[]);
      if (options.batchError) throw options.batchError;
      return [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } }
      ];
    }
  };
  return { db, statements };
}

const baseInput = {
  id: "ledger-1",
  idempotencyKey: "purchase-1",
  userId: "user-1",
  asset: "CASH" as const,
  direction: "DEBIT" as const,
  amount: 25n,
  reason: "SHOP_PURCHASE"
};

test("wallet repository submits a single atomic D1 batch and binds exact integer text", async () => {
  const { db, statements } = mockDb();
  const result = await new WalletLedgerRepository(db).applyDelta(baseInput);
  assert.deepEqual(result, { status: "applied" });
  assert.equal(statements.length, 4);
  assert.match(statements[0].sql, /ON CONFLICT\("idempotencyKey"\) DO NOTHING/);
  assert.match(statements[1].sql, /changes\(\) = 1/);
  assert.equal(statements[0].values[5], "25");
});

test("wallet repository treats an identical idempotency replay as a duplicate", async () => {
  const { db } = mockDb({
    batchError: new Error("guard constraint failed"),
    existing: {
      userId: "user-1", asset: "CASH", direction: "DEBIT", amount: "25",
      reason: "SHOP_PURCHASE", referenceType: null, referenceId: null
    }
  });
  const result = await new WalletLedgerRepository(db).applyDelta(baseInput);
  assert.deepEqual(result, { status: "duplicate" });
});

test("wallet repository rejects reuse of an idempotency key with different payload", async () => {
  const { db } = mockDb({
    batchError: new Error("guard constraint failed"),
    existing: {
      userId: "user-1", asset: "CASH", direction: "DEBIT", amount: "20",
      reason: "SHOP_PURCHASE", referenceType: null, referenceId: null
    }
  });
  await assert.rejects(
    new WalletLedgerRepository(db).applyDelta(baseInput),
    IdempotencyConflictError
  );
});

test("wallet repository classifies insufficient funds and missing wallets", async () => {
  const insufficient = mockDb({
    batchError: new Error("guard constraint failed"),
    wallet: { balance: "10", version: 1 }
  });
  await assert.rejects(
    new WalletLedgerRepository(insufficient.db).applyDelta(baseInput),
    InsufficientFundsError
  );

  const missing = mockDb({ batchError: new Error("guard constraint failed"), wallet: null });
  await assert.rejects(
    new WalletLedgerRepository(missing.db).applyDelta(baseInput),
    WalletNotFoundError
  );
});
