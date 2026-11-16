import test from "node:test";
import assert from "node:assert/strict";
import {
  EconomyD1Database,
  EconomyD1Statement,
  GroupRewardRepository,
  MarketEconomyRepository,
} from "../src/repositories/market-economy.js";

class Statement implements EconomyD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...values: unknown[]): EconomyD1Statement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { return null as T | null; }
}

class FakeD1 implements EconomyD1Database {
  statements: Statement[] = [];
  batchCalls = 0;
  batchResults: Array<{ meta?: { changes?: number } }> = [];
  prepare(query: string): EconomyD1Statement {
    const statement = new Statement(query);
    this.statements.push(statement);
    return statement;
  }
  async batch(statements: EconomyD1Statement[]) {
    this.batchCalls += 1;
    this.statements = statements as Statement[];
    return this.batchResults.length ? this.batchResults : statements.map(() => ({ meta: { changes: 1 } }));
  }
}

const transferInput = {
  idempotencyKey: "market-transfer-1",
  buyerLedgerId: "ledger-buyer-1",
  sellerLedgerId: "ledger-seller-1",
  buyerFinanceEntryId: "finance-buyer-1",
  sellerFinanceEntryId: "finance-seller-1",
  listingId: "listing-1",
  playerId: "player-1",
  buyerClubId: "club-buyer",
  sellerClubId: "club-seller",
  amount: "9007199254740993",
  occurredAt: "2026-11-15T10:00:00.000Z",
};

test("market transfer uses one guarded D1 batch for both wallets, listing, player and finance", async () => {
  const db = new FakeD1();
  const repository = new MarketEconomyRepository(db);
  assert.deepEqual(await repository.transferListedPlayer(transferInput), { status: "transferred" });
  assert.equal(db.batchCalls, 1);
  assert.equal(db.statements.length, 13);
  assert.match(db.statements[0].sql, /ON CONFLICT\("idempotencyKey"\) DO NOTHING/);
  assert.match(db.statements[1].sql, /"balance" >= CAST\(\? AS INTEGER\)/);
  assert.match(db.statements[4].sql, /9223372036854775807/);
  assert.match(db.statements[6].sql, /"status" = 'OPEN'/);
  assert.match(db.statements[8].sql, /"lineupSlot" = NULL/);
  assert.match(db.statements[10].sql, /PLAYER_TRANSFER/);
  assert.equal(db.statements[0].values[2], "9007199254740993");
});

test("market transfer rejects unsafe JavaScript numbers before opening a D1 batch", async () => {
  const db = new FakeD1();
  const repository = new MarketEconomyRepository(db);
  await assert.rejects(
    repository.transferListedPlayer({ ...transferInput, amount: Number.MAX_SAFE_INTEGER + 1 }),
    /Unsafe JavaScript number/,
  );
  assert.equal(db.batchCalls, 0);
});

test("market transfer rejects same buyer and seller club", async () => {
  const db = new FakeD1();
  const repository = new MarketEconomyRepository(db);
  await assert.rejects(
    repository.transferListedPlayer({ ...transferInput, buyerClubId: "club-seller" }),
    /must differ/,
  );
  assert.equal(db.batchCalls, 0);
});

test("group reward purchase atomically deducts points and writes grant plus ledger", async () => {
  const db = new FakeD1();
  const repository = new GroupRewardRepository(db);
  assert.deepEqual(await repository.purchase({
    id: "grant-1",
    idempotencyKey: "reward-purchase-1",
    groupId: "group-1",
    itemId: "item-1",
    grantedByUserId: "user-1",
    recipientUserId: "user-2",
    ledgerId: "points-ledger-1",
    occurredAt: "2026-11-15T10:00:00.000Z",
  }), { status: "purchased" });
  assert.equal(db.batchCalls, 1);
  assert.equal(db.statements.length, 6);
  assert.match(db.statements[0].sql, /"active" = 1 AND b\."balance" >= i\."cost"/);
  assert.match(db.statements[1].sql, /"balance" = "balance" -/);
  assert.match(db.statements[3].sql, /'SHOP_PURCHASE'/);
  assert.match(db.statements[3].sql, /ON CONFLICT\("idempotencyKey"\) DO NOTHING/);
});

test("group reward purchase rejects missing idempotency key before batch", async () => {
  const db = new FakeD1();
  const repository = new GroupRewardRepository(db);
  await assert.rejects(repository.purchase({
    id: "grant-1",
    idempotencyKey: "",
    groupId: "group-1",
    itemId: "item-1",
    grantedByUserId: "user-1",
    ledgerId: "points-ledger-1",
  }), /idempotencyKey must be a non-empty string/);
  assert.equal(db.batchCalls, 0);
});
