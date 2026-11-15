import { fromD1Integer } from "../d1-integer.js";

export interface GiftCodeD1Statement {
  bind(...values: unknown[]): GiftCodeD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface GiftCodeD1Database {
  prepare(query: string): GiftCodeD1Statement;
  batch(statements: GiftCodeD1Statement[]): Promise<Array<{ meta?: { changes?: number } }>>;
}

export class GiftCodeUnavailableError extends Error { constructor() { super("Gift code is unavailable"); this.name = "GiftCodeUnavailableError"; } }
export class GiftCodeGroupRequiredError extends Error { constructor() { super("A Telegram group is required"); this.name = "GiftCodeGroupRequiredError"; } }
export class GiftCodeGroupUnavailableError extends Error { constructor() { super("Telegram group is unavailable"); this.name = "GiftCodeGroupUnavailableError"; } }
export class GiftCodeMembershipRequiredError extends Error { constructor() { super("User is not a persisted member of this group"); this.name = "GiftCodeMembershipRequiredError"; } }
export class GiftCodeUserLimitError extends Error { constructor() { super("Per-user redemption limit reached"); this.name = "GiftCodeUserLimitError"; } }
export class GiftCodeExhaustedError extends Error { constructor() { super("Gift code redemption limit reached"); this.name = "GiftCodeExhaustedError"; } }
export class GiftCodeIdempotencyConflictError extends Error { constructor() { super("Idempotency key belongs to a different redemption"); this.name = "GiftCodeIdempotencyConflictError"; } }
export class GiftCodeBalanceOverflowError extends Error { constructor() { super("Wallet or group points balance would overflow"); this.name = "GiftCodeBalanceOverflowError"; } }

const MAX_VERSION = 2_147_483_647;
const GUARD = "INSERT INTO fe_write_guard (assertion) VALUES (changes())";
const CLEAR_GUARD = "DELETE FROM fe_write_guard";

interface GiftRow {
  id: string; code: string; rewardType: string;
  cashAmount: string; goldAmount: string; groupPoints: string;
  active: number; startsAt: string; expiresAt: string | null;
  maxRedemptions: number; redeemedCount: number; perUserLimit: number;
}
interface PriorRedemption {
  giftCodeId: string; userId: string; groupId: string | null;
  cashAmount: string; goldAmount: string; groupPoints: string; code: string;
}
interface GroupRow { id: string; isActive: number; isSuspended: number; points: string; }

export interface GiftCodeRedemptionInput {
  id: string;
  idempotencyKey: string;
  code: string;
  userId: string;
  telegramGroupId?: string | null;
  cashLedgerId: string;
  goldLedgerId: string;
  groupLedgerId: string;
  cashWalletId: string;
  goldWalletId: string;
  now?: string;
}
export interface GiftCodeRedemptionResult {
  status: "redeemed" | "duplicate";
  reward: { cash: string; gold: string; groupPoints: string };
}

export class GiftCodeRedemptionRepository {
  constructor(private readonly db: GiftCodeD1Database) {}

  async redeem(input: GiftCodeRedemptionInput): Promise<GiftCodeRedemptionResult> {
    for (const [key, value] of Object.entries(input)) {
      if (key === "now" || key === "telegramGroupId") continue;
      if (typeof value !== "string" || !value.trim()) throw new TypeError(key + " must be a non-empty string");
    }
    if (input.idempotencyKey.length < 12 || input.idempotencyKey.length > 128) throw new TypeError("idempotencyKey length is invalid");
    const now = input.now ?? new Date().toISOString();
    const code = input.code.trim().toUpperCase();

    const gift = await this.findGift(code);
    if (!gift) throw new GiftCodeUnavailableError();
    const cash = fromD1Integer(gift.cashAmount);
    const gold = fromD1Integer(gift.goldAmount);
    const points = fromD1Integer(gift.groupPoints);
    if (cash === null || gold === null || points === null || cash < 0n || gold < 0n || points < 0n) {
      throw new RangeError("Gift code rewards must be non-negative signed 64-bit integers");
    }
    if (gift.rewardType !== "GROUP_POINTS" && points !== 0n) {
      // Keep legacy reward semantics explicit: group points are only issued by GROUP_POINTS codes.
      throw new TypeError("Non-group gift codes cannot issue group points");
    }
    if (gift.rewardType === "GROUP_POINTS" && !input.telegramGroupId) throw new GiftCodeGroupRequiredError();

    const group = gift.rewardType === "GROUP_POINTS"
      ? await this.findGroup(input.telegramGroupId as string, input.userId)
      : null;
    if (gift.rewardType === "GROUP_POINTS" && group && (group.isActive !== 1 || group.isSuspended === 1)) throw new GiftCodeGroupUnavailableError();
    if (gift.rewardType === "GROUP_POINTS" && !group) {
      const raw = await this.db.prepare(
        'SELECT "id", "isActive", "isSuspended", CAST("points" AS TEXT) AS "points" FROM "TelegramGroup" WHERE "telegramId" = ? LIMIT 1'
      ).bind(input.telegramGroupId).first<GroupRow>();
      if (!raw || raw.isActive !== 1 || raw.isSuspended === 1) throw new GiftCodeGroupUnavailableError();
      throw new GiftCodeMembershipRequiredError();
    }

    const prior = await this.findPrior(input.idempotencyKey);
    if (prior) {
      if (prior.userId !== input.userId || prior.giftCodeId !== gift.id || prior.code !== code ||
          prior.groupId !== (group?.id ?? null) ||
          prior.cashAmount !== cash.toString() || prior.goldAmount !== gold.toString() ||
          prior.groupPoints !== points.toString()) throw new GiftCodeIdempotencyConflictError();
      return { status: "duplicate", reward: { cash: prior.cashAmount, gold: prior.goldAmount, groupPoints: prior.groupPoints } };
    }

    if (gift.active !== 1 || gift.startsAt > now || (gift.expiresAt !== null && gift.expiresAt <= now)) {
      throw new GiftCodeUnavailableError();
    }
    if (gift.redeemedCount >= gift.maxRedemptions) throw new GiftCodeExhaustedError();
    const used = await this.db.prepare(
      'SELECT COUNT(*) AS "count" FROM "GiftCodeRedemption" WHERE "giftCodeId" = ? AND "userId" = ?'
    ).bind(gift.id, input.userId).first<{ count: number }>();
    if ((used?.count ?? 0) >= gift.perUserLimit) throw new GiftCodeUserLimitError();

    const statements: GiftCodeD1Statement[] = [
      this.db.prepare(
        'INSERT INTO "GiftCodeRedemption" ("id", "giftCodeId", "userId", "idempotencyKey", "cashAmount", "goldAmount", "groupPoints", "redeemedAt", "groupId") ' +
        'SELECT ?, g."id", ?, ?, CAST(? AS INTEGER), CAST(? AS INTEGER), CAST(? AS INTEGER), ?, ' +
        'CASE WHEN g."rewardType" = \'GROUP_POINTS\' THEN (SELECT tg."id" FROM "TelegramGroup" tg WHERE tg."telegramId" = ? AND tg."isActive" = 1 AND tg."isSuspended" = 0 AND EXISTS (SELECT 1 FROM "GroupMembership" gm WHERE gm."groupId" = tg."id" AND gm."userId" = ?)) ELSE NULL END ' +
        'FROM "GiftCode" g WHERE g."id" = ? AND g."active" = 1 AND g."startsAt" <= ? AND (g."expiresAt" IS NULL OR g."expiresAt" > ?) ' +
        'AND g."redeemedCount" < g."maxRedemptions" AND (SELECT COUNT(*) FROM "GiftCodeRedemption" r WHERE r."giftCodeId" = g."id" AND r."userId" = ?) < g."perUserLimit" ' +
        'AND (g."rewardType" <> \'GROUP_POINTS\' OR EXISTS (SELECT 1 FROM "TelegramGroup" tg JOIN "GroupMembership" gm ON gm."groupId" = tg."id" WHERE tg."telegramId" = ? AND tg."isActive" = 1 AND tg."isSuspended" = 0 AND gm."userId" = ?)) ' +
        'ON CONFLICT("idempotencyKey") DO NOTHING'
      ).bind(input.id, input.userId, input.idempotencyKey, cash.toString(), gold.toString(), points.toString(), now,
        input.telegramGroupId ?? "", input.userId, gift.id, now, now, input.userId,
        input.telegramGroupId ?? "", input.userId),
      this.db.prepare(GUARD),
      this.db.prepare(
        'UPDATE "GiftCode" SET "redeemedCount" = "redeemedCount" + 1 WHERE "id" = ? AND changes() = 1 AND "active" = 1 AND "redeemedCount" < "maxRedemptions" AND "startsAt" <= ? AND ("expiresAt" IS NULL OR "expiresAt" > ?)'
      ).bind(gift.id, now, now),
      this.db.prepare(GUARD),
    ];
    const guardIndexes = [1, 3];

    const appendWalletCredit = (asset: "CASH" | "GOLD", amount: bigint, walletId: string, ledgerId: string) => {
      if (amount === 0n) return;
      const key = input.idempotencyKey + ":" + asset;
      statements.push(this.db.prepare(
        'INSERT INTO "LedgerTransaction" ("id", "idempotencyKey", "userId", "asset", "direction", "amount", "reason", "referenceType", "referenceId", "createdAt") ' +
        'SELECT ?, ?, ?, ?, \'CREDIT\', CAST(? AS INTEGER), \'GIFT_CODE_REDEMPTION\', \'GIFT_CODE\', ?, ? WHERE changes() = 1 ON CONFLICT("idempotencyKey") DO NOTHING'
      ).bind(ledgerId, key, input.userId, asset, amount.toString(), gift.id, now));
      guardIndexes.push(statements.length);
      statements.push(this.db.prepare(GUARD));
      statements.push(this.db.prepare(
        'INSERT INTO "Wallet" ("id", "userId", "asset", "balance", "version", "createdAt", "updatedAt") ' +
        'SELECT ?, ?, ?, CAST(? AS INTEGER), 0, ?, ? WHERE changes() = 1 ' +
        'ON CONFLICT("userId", "asset") DO UPDATE SET "balance" = "Wallet"."balance" + excluded."balance", "version" = "Wallet"."version" + 1, "updatedAt" = excluded."updatedAt" ' +
        'WHERE "Wallet"."balance" <= 9223372036854775807 - excluded."balance" AND "Wallet"."version" < 2147483647'
      ).bind(walletId, input.userId, asset, amount.toString(), now, now));
      guardIndexes.push(statements.length);
      statements.push(this.db.prepare(GUARD));
    };
    appendWalletCredit("CASH", cash, input.cashWalletId, input.cashLedgerId);
    appendWalletCredit("GOLD", gold, input.goldWalletId, input.goldLedgerId);

    if (gift.rewardType === "GROUP_POINTS" && group && points > 0n) {
      statements.push(this.db.prepare(
        'UPDATE "TelegramGroup" SET "points" = "points" + CAST(? AS INTEGER) WHERE "id" = ? AND changes() = 1 AND "isActive" = 1 AND "isSuspended" = 0 AND "points" <= 9223372036854775807 - CAST(? AS INTEGER)'
      ).bind(points.toString(), group.id, points.toString()));
      guardIndexes.push(statements.length);
      statements.push(this.db.prepare(GUARD));
      statements.push(this.db.prepare(
        'INSERT INTO "GroupPointLedger" ("id", "idempotencyKey", "groupId", "userId", "amount", "source", "description", "createdAt") ' +
        'SELECT ?, ?, ?, ?, CAST(? AS INTEGER), \'GIFT_CODE\', ?, ? WHERE changes() = 1 ON CONFLICT("idempotencyKey") DO NOTHING'
      ).bind(input.groupLedgerId, input.idempotencyKey + ":GROUP_POINTS", group.id, input.userId, points.toString(), "Gift code redemption: " + code, now));
      guardIndexes.push(statements.length);
      statements.push(this.db.prepare(GUARD));
    }
    statements.push(this.db.prepare(CLEAR_GUARD));

    try {
      const results = await this.db.batch(statements);
      const requiredChanges = results.filter((_, index) => statements[index] !== undefined && (
        index === 0 || (index > 0 && statements[index].toString() === "")
      ));
      if (results[0]?.meta?.changes !== 1 || results[2]?.meta?.changes !== 1) {
        throw new Error("Gift-code batch did not reserve and increment the code");
      }
      // Every guarded mutation is followed by a CHECK-constrained guard insert.
      for (const index of guardIndexes) {
        if (results[index]?.meta?.changes !== 1) throw new Error("Gift-code write guard failed");
      }
      return { status: "redeemed", reward: { cash: cash.toString(), gold: gold.toString(), groupPoints: points.toString() } };
    } catch (error) {
      const replay = await this.findPrior(input.idempotencyKey).catch(() => null);
      if (replay) {
        if (replay.userId === input.userId && replay.giftCodeId === gift.id && replay.code === code && replay.groupId === (group?.id ?? null) &&
            replay.cashAmount === cash.toString() && replay.goldAmount === gold.toString() && replay.groupPoints === points.toString()) {
          return { status: "duplicate", reward: { cash: replay.cashAmount, gold: replay.goldAmount, groupPoints: replay.groupPoints } };
        }
        throw new GiftCodeIdempotencyConflictError();
      }
      const fresh = await this.findGift(code).catch(() => null);
      if (!fresh || fresh.active !== 1 || fresh.startsAt > now || (fresh.expiresAt && fresh.expiresAt <= now)) throw new GiftCodeUnavailableError();
      if (fresh.redeemedCount >= fresh.maxRedemptions) throw new GiftCodeExhaustedError();
      const count = await this.db.prepare(
        'SELECT COUNT(*) AS "count" FROM "GiftCodeRedemption" WHERE "giftCodeId" = ? AND "userId" = ?'
      ).bind(gift.id, input.userId).first<{ count: number }>().catch(() => null);
      if ((count?.count ?? 0) >= fresh.perUserLimit) throw new GiftCodeUserLimitError();
      if (gift.rewardType === "GROUP_POINTS" && input.telegramGroupId) {
        const groupState = await this.db.prepare(
          'SELECT "id", "isActive", "isSuspended", CAST("points" AS TEXT) AS "points" FROM "TelegramGroup" WHERE "telegramId" = ? LIMIT 1'
        ).bind(input.telegramGroupId).first<{ id: string; isActive: number; isSuspended: number; points: string }>().catch(() => null);
        if (!groupState || groupState.isActive !== 1 || groupState.isSuspended === 1) throw new GiftCodeGroupUnavailableError();
        const membership = await this.db.prepare(
          'SELECT "id" FROM "GroupMembership" WHERE "groupId" = ? AND "userId" = ? LIMIT 1'
        ).bind(groupState.id, input.userId).first<{ id: string }>().catch(() => null);
        if (!membership) throw new GiftCodeMembershipRequiredError();
        if (points > 0n && fromD1Integer(groupState.points)! > ((1n << 63n) - 1n) - points) {
          throw new GiftCodeBalanceOverflowError();
        }
      }
      for (const [asset, amount] of [["CASH", cash], ["GOLD", gold]] as const) {
        if (amount === 0n) continue;
        const wallet = await this.db.prepare(
          'SELECT CAST("balance" AS TEXT) AS "balance", "version" FROM "Wallet" WHERE "userId" = ? AND "asset" = ? LIMIT 1'
        ).bind(input.userId, asset).first<{ balance: string; version: number }>().catch(() => null);
        if (wallet && (wallet.version >= MAX_VERSION || fromD1Integer(wallet.balance)! > ((1n << 63n) - 1n) - amount)) {
          throw new GiftCodeBalanceOverflowError();
        }
      }
      throw error;
    }
  }

  private async findGift(code: string): Promise<GiftRow | null> {
    return this.db.prepare(
      'SELECT "id", "code", "rewardType", CAST("cashAmount" AS TEXT) AS "cashAmount", CAST("goldAmount" AS TEXT) AS "goldAmount", CAST("groupPoints" AS TEXT) AS "groupPoints", "active", "startsAt", "expiresAt", "maxRedemptions", "redeemedCount", "perUserLimit" FROM "GiftCode" WHERE "code" = ? LIMIT 1'
    ).bind(code).first<GiftRow>();
  }
  private async findGroup(telegramId: string, userId: string): Promise<GroupRow & { id: string } | null> {
    return this.db.prepare(
      'SELECT tg."id", tg."isActive", tg."isSuspended", CAST(tg."points" AS TEXT) AS "points" FROM "TelegramGroup" tg JOIN "GroupMembership" gm ON gm."groupId" = tg."id" AND gm."userId" = ? WHERE tg."telegramId" = ? LIMIT 1'
    ).bind(userId, telegramId).first<GroupRow & { id: string }>();
  }
  private async findPrior(key: string): Promise<PriorRedemption | null> {
    return this.db.prepare(
      'SELECT r."giftCodeId", r."userId", r."groupId", CAST(r."cashAmount" AS TEXT) AS "cashAmount", CAST(r."goldAmount" AS TEXT) AS "goldAmount", CAST(r."groupPoints" AS TEXT) AS "groupPoints", g."code" FROM "GiftCodeRedemption" r JOIN "GiftCode" g ON g."id" = r."giftCodeId" WHERE r."idempotencyKey" = ? LIMIT 1'
    ).bind(key).first<PriorRedemption>();
  }
}
