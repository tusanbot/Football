import test from "node:test";
import assert from "node:assert/strict";
import {
  GiftCodeD1Database,
  GiftCodeD1Statement,
  GiftCodeRedemptionRepository,
} from "../src/repositories/gift-code-redemption.js";

class Statement implements GiftCodeD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]): GiftCodeD1Statement { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM "GiftCode" WHERE "code"')) return this.db.gift as T;
    if (this.sql.includes('FROM "TelegramGroup" tg JOIN "GroupMembership"')) return this.db.group as T;
    if (this.sql.includes('FROM "TelegramGroup" WHERE "telegramId"')) return this.db.rawGroup as T;
    if (this.sql.includes('FROM "GiftCodeRedemption" r JOIN "GiftCode"')) return this.db.prior as T;
    if (this.sql.includes('COUNT(*) AS "count"')) return { count: 0 } as T;
    return null;
  }
}
class FakeD1 implements GiftCodeD1Database {
  gift: Record<string, unknown> | null = {
    id: "gift-1", code: "WELCOME", rewardType: "WALLET",
    cashAmount: "9007199254740993", goldAmount: "0", groupPoints: "0",
    active: 1, startsAt: "2026-01-01T00:00:00.000Z", expiresAt: null,
    maxRedemptions: 100, redeemedCount: 0, perUserLimit: 1,
  };
  group: Record<string, unknown> | null = null;
  rawGroup: Record<string, unknown> | null = null;
  prior: Record<string, unknown> | null = null;
  statements: Statement[] = [];
  batchCalls = 0;
  prepare(sql: string): GiftCodeD1Statement {
    const statement = new Statement(sql, this);
    this.statements.push(statement);
    return statement;
  }
  async batch(statements: GiftCodeD1Statement[]) {
    this.batchCalls += 1;
    this.statements = statements as Statement[];
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
}
const baseInput = {
  id: "redemption-1",
  idempotencyKey: "gift-redeem-key-0001",
  code: "welcome",
  userId: "user-1",
  cashLedgerId: "cash-ledger-1",
  goldLedgerId: "gold-ledger-1",
  groupLedgerId: "group-ledger-1",
  cashWalletId: "cash-wallet-1",
  goldWalletId: "gold-wallet-1",
  now: "2026-11-15T10:00:00.000Z",
};

test("wallet gift redemption uses one guarded D1 batch and preserves large integer amounts", async () => {
  const db = new FakeD1();
  const result = await new GiftCodeRedemptionRepository(db).redeem(baseInput);
  assert.deepEqual(result, {
    status: "redeemed",
    reward: { cash: "9007199254740993", gold: "0", groupPoints: "0" },
  });
  assert.equal(db.batchCalls, 1);
  assert.equal(db.statements.length, 9);
  assert.match(db.statements[0].sql, /"redeemedCount" < "g"."maxRedemptions"/);
  assert.match(db.statements[6].sql, /9223372036854775807/);
  assert.match(db.statements[6].sql, /ON CONFLICT\("userId", "asset"\) DO UPDATE/);
  assert.equal(db.statements[0].values[3], "9007199254740993");
});

test("group-points redemption rechecks persisted active group membership in the atomic insert", async () => {
  const db = new FakeD1();
  db.gift = {
    id: "gift-2", code: "GROUP2026", rewardType: "GROUP_POINTS",
    cashAmount: "0", goldAmount: "0", groupPoints: "250",
    active: 1, startsAt: "2026-01-01T00:00:00.000Z", expiresAt: null,
    maxRedemptions: 50, redeemedCount: 0, perUserLimit: 1,
  };
  db.group = { id: "group-db-1", isActive: 1, isSuspended: 0, points: "10" };
  const result = await new GiftCodeRedemptionRepository(db).redeem({
    ...baseInput, code: "group2026", telegramGroupId: "-1001234567890",
  });
  assert.equal(result.status, "redeemed");
  assert.equal(result.reward.groupPoints, "250");
  assert.equal(db.batchCalls, 1);
  assert.ok(db.statements.some(s => s.sql.includes('"GroupPointLedger"')));
  assert.ok(db.statements.some(s => s.sql.includes('"points" <= 9223372036854775807')));
  assert.ok(db.statements[0].sql.includes('"GroupMembership"'));
});

test("gift redemption rejects group-points rewards without a group before batch", async () => {
  const db = new FakeD1();
  db.gift = { ...db.gift!, rewardType: "GROUP_POINTS", groupPoints: "10" };
  await assert.rejects(
    new GiftCodeRedemptionRepository(db).redeem(baseInput),
    /Telegram group is required/,
  );
  assert.equal(db.batchCalls, 0);
});

test("gift redemption returns a verified idempotent replay", async () => {
  const db = new FakeD1();
  db.prior = {
    giftCodeId: "gift-1", userId: "user-1", groupId: null,
    cashAmount: "9007199254740993", goldAmount: "0", groupPoints: "0", code: "WELCOME",
  };
  const result = await new GiftCodeRedemptionRepository(db).redeem(baseInput);
  assert.equal(result.status, "duplicate");
  assert.equal(db.batchCalls, 0);
});

test("gift redemption rejects idempotency key reuse for a different user", async () => {
  const db = new FakeD1();
  db.prior = {
    giftCodeId: "gift-1", userId: "another-user", groupId: null,
    cashAmount: "9007199254740993", goldAmount: "0", groupPoints: "0", code: "WELCOME",
  };
  await assert.rejects(
    new GiftCodeRedemptionRepository(db).redeem(baseInput),
    /different redemption/,
  );
  assert.equal(db.batchCalls, 0);
});
