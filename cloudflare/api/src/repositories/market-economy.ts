import { fromD1Integer, toD1Integer } from "../d1-integer.js";

export interface EconomyD1Statement {
  bind(...values: unknown[]): EconomyD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface EconomyD1Database {
  prepare(query: string): EconomyD1Statement;
  batch(statements: EconomyD1Statement[]): Promise<Array<{ meta?: { changes?: number } }>>;
}

export class MarketListingUnavailableError extends Error {
  constructor() { super("Market listing is unavailable, expired, or no longer belongs to the seller"); this.name = "MarketListingUnavailableError"; }
}
export class EconomyWalletNotFoundError extends Error {
  constructor() { super("Buyer or seller wallet does not exist"); this.name = "EconomyWalletNotFoundError"; }
}
export class EconomyInsufficientFundsError extends Error {
  constructor() { super("Buyer wallet has insufficient funds"); this.name = "EconomyInsufficientFundsError"; }
}
export class EconomyBalanceOverflowError extends Error {
  constructor() { super("Seller wallet balance would exceed SQLite signed 64-bit range"); this.name = "EconomyBalanceOverflowError"; }
}
export class EconomyIdempotencyConflictError extends Error {
  constructor() { super("Idempotency key was already used for a different operation"); this.name = "EconomyIdempotencyConflictError"; }
}
export class GroupRewardUnavailableError extends Error {
  constructor() { super("Group reward is unavailable or inactive"); this.name = "GroupRewardUnavailableError"; }
}
export class GroupRewardInsufficientPointsError extends Error {
  constructor() { super("Group member has insufficient reward points"); this.name = "GroupRewardInsufficientPointsError"; }
}

const MAX_VERSION = 2_147_483_647;
const MAX_INT64 = (1n << 63n) - 1n;

export interface PlayerMarketTransferInput {
  idempotencyKey: string;
  buyerLedgerId: string;
  sellerLedgerId: string;
  buyerFinanceEntryId: string;
  sellerFinanceEntryId: string;
  listingId: string;
  playerId: string;
  buyerClubId: string;
  sellerClubId: string;
  amount: bigint | string | number;
  occurredAt?: string;
}

interface LedgerIdentity {
  userId: string;
  asset: string;
  direction: string;
  amount: string;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
}

interface TransferState {
  status: string;
  buyerClubId: string | null;
  playerClubId: string;
}

const INSERT_BUYER_LEDGER = [
  'INSERT INTO "LedgerTransaction" ("id", "idempotencyKey", "userId", "asset", "direction", "amount", "reason", "referenceType", "referenceId", "createdAt")',
  'SELECT ?, ?, buyer."ownerId", \'CASH\', \'DEBIT\', CAST(? AS INTEGER), \'PLAYER_MARKET_PURCHASE\', \'PlayerMarketListing\', ?, ?',
  'FROM "Club" buyer WHERE buyer."id" = ? AND buyer."id" <> ?',
  'ON CONFLICT("idempotencyKey") DO NOTHING'
].join(" ");

const DEBIT_BUYER_WALLET = [
  'UPDATE "Wallet" SET "balance" = "balance" - CAST(? AS INTEGER), "version" = "version" + 1, "updatedAt" = ?',
  'WHERE "userId" = (SELECT "ownerId" FROM "Club" WHERE "id" = ?) AND "asset" = \'CASH\'',
  'AND changes() = 1 AND CAST(? AS INTEGER) > 0 AND "balance" >= CAST(? AS INTEGER) AND "version" < 2147483647'
].join(" ");

const INSERT_SELLER_LEDGER = [
  'INSERT INTO "LedgerTransaction" ("id", "idempotencyKey", "userId", "asset", "direction", "amount", "reason", "referenceType", "referenceId", "createdAt")',
  'SELECT ?, ?, seller."ownerId", \'CASH\', \'CREDIT\', CAST(? AS INTEGER), \'PLAYER_MARKET_SALE\', \'PlayerMarketListing\', ?, ?',
  'FROM "Club" seller WHERE seller."id" = ? AND seller."id" <> ?',
  'ON CONFLICT("idempotencyKey") DO NOTHING'
].join(" ");

const CREDIT_SELLER_WALLET = [
  'UPDATE "Wallet" SET "balance" = "balance" + CAST(? AS INTEGER), "version" = "version" + 1, "updatedAt" = ?',
  'WHERE "userId" = (SELECT "ownerId" FROM "Club" WHERE "id" = ?) AND "asset" = \'CASH\'',
  'AND changes() = 1 AND CAST(? AS INTEGER) > 0 AND "balance" <= 9223372036854775807 - CAST(? AS INTEGER) AND "version" < 2147483647'
].join(" ");

const SELL_LISTING = [
  'UPDATE "PlayerMarketListing" SET "status" = \'SOLD\', "buyerClubId" = ?, "updatedAt" = ?',
  'WHERE "id" = ? AND "playerId" = ? AND "sellerClubId" = ? AND "status" = \'OPEN\'',
  'AND "expiresAt" > ? AND "askingPrice" = CAST(? AS INTEGER) AND changes() = 1'
].join(" ");

const MOVE_PLAYER = [
  'UPDATE "Player" SET "clubId" = ?, "lineupSlot" = NULL, "updatedAt" = ?',
  'WHERE "id" = ? AND "clubId" = ? AND changes() = 1',
  'AND EXISTS (SELECT 1 FROM "PlayerMarketListing" WHERE "id" = ? AND "status" = \'SOLD\' AND "buyerClubId" = ?)'
].join(" ");

const INSERT_BUYER_FINANCE = [
  'INSERT INTO "ClubFinanceEntry" ("id", "idempotencyKey", "clubId", "category", "direction", "amount", "description", "occurredAt")',
  'VALUES (?, ?, ?, \'PLAYER_TRANSFER\', \'DEBIT\', CAST(? AS INTEGER), ?, ?)'
].join(" ");

const INSERT_SELLER_FINANCE = [
  'INSERT INTO "ClubFinanceEntry" ("id", "idempotencyKey", "clubId", "category", "direction", "amount", "description", "occurredAt")',
  'VALUES (?, ?, ?, \'PLAYER_TRANSFER\', \'CREDIT\', CAST(? AS INTEGER), ?, ?)'
].join(" ");

const GUARD = "INSERT INTO fe_write_guard (assertion) VALUES (changes())";
const CLEAR_GUARD = "DELETE FROM fe_write_guard";

export class MarketEconomyRepository {
  constructor(private readonly db: EconomyD1Database) {}

  async transferListedPlayer(input: PlayerMarketTransferInput): Promise<{ status: "transferred" | "duplicate" }> {
    this.validateTransfer(input);
    const amountText = toD1Integer(input.amount);
    const amount = BigInt(amountText);
    if (amount <= 0n) throw new RangeError("Transfer amount must be greater than zero");
    if (input.buyerClubId === input.sellerClubId) throw new TypeError("Buyer and seller clubs must differ");
    const at = input.occurredAt ?? new Date().toISOString();
    const buyerKey = input.idempotencyKey + ":buyer";
    const sellerKey = input.idempotencyKey + ":seller";

    try {
      const results = await this.db.batch([
        this.db.prepare(INSERT_BUYER_LEDGER).bind(input.buyerLedgerId, buyerKey, amountText, input.listingId, at, input.buyerClubId, input.sellerClubId),
        this.db.prepare(DEBIT_BUYER_WALLET).bind(amountText, at, input.buyerClubId, amountText, amountText),
        this.db.prepare(GUARD),
        this.db.prepare(INSERT_SELLER_LEDGER).bind(input.sellerLedgerId, sellerKey, amountText, input.listingId, at, input.sellerClubId, input.buyerClubId),
        this.db.prepare(CREDIT_SELLER_WALLET).bind(amountText, at, input.sellerClubId, amountText, amountText),
        this.db.prepare(GUARD),
        this.db.prepare(SELL_LISTING).bind(input.buyerClubId, at, input.listingId, input.playerId, input.sellerClubId, at, amountText),
        this.db.prepare(GUARD),
        this.db.prepare(MOVE_PLAYER).bind(input.buyerClubId, at, input.playerId, input.sellerClubId, input.listingId, input.buyerClubId),
        this.db.prepare(GUARD),
        this.db.prepare(INSERT_BUYER_FINANCE).bind(input.buyerFinanceEntryId, input.idempotencyKey + ":buyer-finance", input.buyerClubId, amountText, "Player market purchase " + input.playerId, at),
        this.db.prepare(INSERT_SELLER_FINANCE).bind(input.sellerFinanceEntryId, input.idempotencyKey + ":seller-finance", input.sellerClubId, amountText, "Player market sale " + input.playerId, at),
        this.db.prepare(CLEAR_GUARD),
      ]);
      if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1 ||
          results[3]?.meta?.changes !== 1 || results[4]?.meta?.changes !== 1 ||
          results[6]?.meta?.changes !== 1 || results[8]?.meta?.changes !== 1 ||
          results[10]?.meta?.changes !== 1 || results[11]?.meta?.changes !== 1) {
        throw new Error("D1 player transfer batch did not apply every required mutation");
      }
      return { status: "transferred" };
    } catch (batchError) {
      const [buyerLedger, sellerLedger] = await Promise.all([
        this.findLedger(buyerKey),
        this.findLedger(sellerKey),
      ]).catch(() => [null, null] as const);
      if (buyerLedger || sellerLedger) {
        if (buyerLedger && sellerLedger &&
            this.matchesTransferLedger(buyerLedger, input.buyerClubId, "DEBIT", amountText, input.listingId) &&
            this.matchesTransferLedger(sellerLedger, input.sellerClubId, "CREDIT", amountText, input.listingId)) {
          const state = await this.findTransferState(input.listingId, input.playerId).catch(() => null);
          if (state?.status === "SOLD" && state.buyerClubId === input.buyerClubId && state.playerClubId === input.buyerClubId) {
            return { status: "duplicate" };
          }
        }
        throw new EconomyIdempotencyConflictError();
      }

      const [listing, buyerWallet, sellerWallet] = await Promise.all([
        this.findListing(input.listingId),
        this.findWallet(input.buyerClubId),
        this.findWallet(input.sellerClubId),
      ]).catch(() => [null, null, null] as const);
      if (!listing || listing.status !== "OPEN" || listing.sellerClubId !== input.sellerClubId ||
          listing.playerId !== input.playerId || listing.expiresAt <= at ||
          listing.askingPrice !== amountText) throw new MarketListingUnavailableError();
      if (buyerWallet === null || sellerWallet === null) throw new EconomyWalletNotFoundError();
      if (buyerWallet.version >= MAX_VERSION || sellerWallet.version >= MAX_VERSION) throw batchError;
      const buyerBalance = fromD1Integer(buyerWallet.balance);
      const sellerBalance = fromD1Integer(sellerWallet.balance);
      if (buyerBalance === null || sellerBalance === null) throw new EconomyWalletNotFoundError();
      if (buyerBalance < amount) throw new EconomyInsufficientFundsError();
      if (sellerBalance > MAX_INT64 - amount) throw new EconomyBalanceOverflowError();
      throw batchError;
    }
  }

  private validateTransfer(input: PlayerMarketTransferInput): void {
    for (const [key, value] of Object.entries(input)) {
      if (key === "amount" || key === "occurredAt") continue;
      if (typeof value !== "string" || value.trim() === "") throw new TypeError(key + " must be a non-empty string");
    }
  }

  private async findLedger(key: string): Promise<LedgerIdentity | null> {
    return this.db.prepare(
      'SELECT "userId", "asset", "direction", CAST("amount" AS TEXT) AS "amount", "reason", "referenceType", "referenceId" FROM "LedgerTransaction" WHERE "idempotencyKey" = ? LIMIT 1'
    ).bind(key).first<LedgerIdentity>();
  }

  private async findClubOwner(clubId: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT "ownerId" FROM "Club" WHERE "id" = ? LIMIT 1').bind(clubId).first<{ ownerId: string }>();
    return row?.ownerId ?? null;
  }

  private async findWallet(clubId: string): Promise<{ userId: string; balance: string; version: number } | null> {
    return this.db.prepare(
      'SELECT w."userId", CAST(w."balance" AS TEXT) AS "balance", w."version" FROM "Wallet" w JOIN "Club" c ON c."ownerId" = w."userId" WHERE c."id" = ? AND w."asset" = \'CASH\' LIMIT 1'
    ).bind(clubId).first();
  }

  private async findListing(id: string): Promise<{ status: string; sellerClubId: string; playerId: string; expiresAt: string; askingPrice: string } | null> {
    return this.db.prepare(
      'SELECT "status", "sellerClubId", "playerId", "expiresAt", CAST("askingPrice" AS TEXT) AS "askingPrice" FROM "PlayerMarketListing" WHERE "id" = ? LIMIT 1'
    ).bind(id).first();
  }

  private async findTransferState(listingId: string, playerId: string): Promise<TransferState | null> {
    return this.db.prepare(
      'SELECT l."status", l."buyerClubId", p."clubId" AS "playerClubId" FROM "PlayerMarketListing" l JOIN "Player" p ON p."id" = ? WHERE l."id" = ? LIMIT 1'
    ).bind(playerId, listingId).first();
  }

  private matchesTransferLedger(row: LedgerIdentity, expectedUserId: string, direction: string, amount: string, listingId: string): boolean {
    return row.userId === expectedUserId && row.asset === "CASH" && row.direction === direction && row.amount === amount &&
      row.reason === (direction === "DEBIT" ? "PLAYER_MARKET_PURCHASE" : "PLAYER_MARKET_SALE") &&
      row.referenceType === "PlayerMarketListing" && row.referenceId === listingId;
  }
}

export interface GroupRewardPurchaseInput {
  id: string;
  idempotencyKey: string;
  groupId: string;
  itemId: string;
  grantedByUserId: string;
  recipientUserId?: string | null;
  ledgerId: string;
  occurredAt?: string;
}

interface RewardGrantIdentity {
  groupId: string;
  itemId: string;
  grantedByUserId: string;
  recipientUserId: string | null;
}

export class GroupRewardRepository {
  constructor(private readonly db: EconomyD1Database) {}

  async purchase(input: GroupRewardPurchaseInput): Promise<{ status: "purchased" | "duplicate" }> {
    for (const [key, value] of Object.entries(input)) {
      if (key === "occurredAt" || key === "recipientUserId") continue;
      if (typeof value !== "string" || value.trim() === "") throw new TypeError(key + " must be a non-empty string");
    }
    const at = input.occurredAt ?? new Date().toISOString();
    try {
      const results = await this.db.batch([
        this.db.prepare(
          'INSERT INTO "GroupRewardGrant" ("id", "idempotencyKey", "groupId", "itemId", "grantedByUserId", "recipientUserId", "createdAt") ' +
          'SELECT ?, ?, ?, i."id", ?, ?, ? FROM "GroupRewardItem" i JOIN "GroupMemberRewardBalance" b ON b."groupId" = ? AND b."userId" = ? ' +
          'WHERE i."id" = ? AND i."active" = 1 AND b."balance" >= i."cost" ON CONFLICT("idempotencyKey") DO NOTHING'
        ).bind(input.id, input.idempotencyKey, input.groupId, input.grantedByUserId, input.recipientUserId ?? null, at, input.groupId, input.grantedByUserId, input.itemId),
        this.db.prepare(
          'UPDATE "GroupMemberRewardBalance" SET "balance" = "balance" - (SELECT "cost" FROM "GroupRewardItem" WHERE "id" = ?), "updatedAt" = ? ' +
          'WHERE "groupId" = ? AND "userId" = ? AND changes() = 1 AND "balance" >= (SELECT "cost" FROM "GroupRewardItem" WHERE "id" = ? AND "active" = 1)'
        ).bind(input.itemId, at, input.groupId, input.grantedByUserId, input.itemId),
        this.db.prepare(GUARD),
        this.db.prepare(
          'INSERT INTO "GroupPointLedger" ("id", "idempotencyKey", "groupId", "userId", "amount", "source", "description", "createdAt") ' +
          'SELECT ?, ?, ?, ?, -(SELECT "cost" FROM "GroupRewardItem" WHERE "id" = ?), \'SHOP_PURCHASE\', ?, ? ' +
          'WHERE EXISTS (SELECT 1 FROM "GroupRewardGrant" WHERE "id" = ? AND "idempotencyKey" = ?) ON CONFLICT("idempotencyKey") DO NOTHING'
        ).bind(input.ledgerId, input.idempotencyKey + ":points", input.groupId, input.grantedByUserId, input.itemId, "Purchased group reward " + input.itemId, at, input.id, input.idempotencyKey),
        this.db.prepare(GUARD),
        this.db.prepare(CLEAR_GUARD),
      ]);
      if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1 || results[3]?.meta?.changes !== 1) {
        throw new Error("D1 group reward purchase did not apply every required mutation");
      }
      return { status: "purchased" };
    } catch (batchError) {
      const existing = await this.db.prepare(
        'SELECT "groupId", "itemId", "grantedByUserId", "recipientUserId" FROM "GroupRewardGrant" WHERE "idempotencyKey" = ? LIMIT 1'
      ).bind(input.idempotencyKey).first<RewardGrantIdentity>().catch(() => null);
      if (existing) {
        if (existing.groupId === input.groupId && existing.itemId === input.itemId &&
            existing.grantedByUserId === input.grantedByUserId &&
            existing.recipientUserId === (input.recipientUserId ?? null)) return { status: "duplicate" };
        throw new EconomyIdempotencyConflictError();
      }
      const [item, balance] = await Promise.all([
        this.db.prepare('SELECT "active", CAST("cost" AS TEXT) AS "cost" FROM "GroupRewardItem" WHERE "id" = ? LIMIT 1').bind(input.itemId).first<{ active: number; cost: string }>(),
        this.db.prepare('SELECT CAST("balance" AS TEXT) AS "balance" FROM "GroupMemberRewardBalance" WHERE "groupId" = ? AND "userId" = ? LIMIT 1').bind(input.groupId, input.grantedByUserId).first<{ balance: string }>(),
      ]).catch(() => [null, null] as const);
      if (!item || item.active !== 1) throw new GroupRewardUnavailableError();
      if (!balance) throw new GroupRewardInsufficientPointsError();
      const available = fromD1Integer(balance.balance);
      const cost = fromD1Integer(item.cost);
      if (available === null || cost === null || available < cost) throw new GroupRewardInsufficientPointsError();
      throw batchError;
    }
  }
}
