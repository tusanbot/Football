import { fromD1Integer, toD1Integer } from "../d1-integer.js";

export type WalletAsset = "CASH" | "GOLD";
export type LedgerDirection = "CREDIT" | "DEBIT";

export interface WalletDeltaInput {
  id: string;
  idempotencyKey: string;
  userId: string;
  asset: WalletAsset;
  direction: LedgerDirection;
  amount: bigint | string | number;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt?: string;
}

interface D1Result {
  meta?: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface WalletLedgerD1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface ExistingLedgerRow {
  userId: string;
  asset: WalletAsset;
  direction: LedgerDirection;
  amount: string;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
}

interface WalletRow {
  balance: string;
  version: number;
}

const SQLITE_INT64_MAX = (1n << 63n) - 1n;
const SQLITE_INT32_MAX = 2_147_483_647;

export class WalletNotFoundError extends Error {
  constructor() { super("Wallet does not exist"); this.name = "WalletNotFoundError"; }
}
export class InsufficientFundsError extends Error {
  constructor() { super("Wallet balance is insufficient"); this.name = "InsufficientFundsError"; }
}
export class WalletBalanceOverflowError extends Error {
  constructor() { super("Wallet balance would exceed SQLite signed 64-bit range"); this.name = "WalletBalanceOverflowError"; }
}
export class WalletVersionOverflowError extends Error {
  constructor() { super("Wallet version reached the Prisma Int limit"); this.name = "WalletVersionOverflowError"; }
}
export class IdempotencyConflictError extends Error {
  constructor() { super("Idempotency key was already used with a different wallet operation"); this.name = "IdempotencyConflictError"; }
}

const INSERT_LEDGER = [
  'INSERT INTO "LedgerTransaction" ("id", "idempotencyKey", "userId", "asset", "direction", "amount", "reason", "referenceType", "referenceId", "createdAt")',
  'VALUES (?, ?, ?, ?, ?, CAST(? AS INTEGER), ?, ?, ?, ?)',
  'ON CONFLICT("idempotencyKey") DO NOTHING'
].join(" ");

const UPDATE_WALLET = [
  'UPDATE "Wallet"',
  'SET "balance" = "balance" + CASE WHEN ? = "CREDIT" THEN CAST(? AS INTEGER) ELSE -CAST(? AS INTEGER) END,',
  '"version" = "version" + 1, "updatedAt" = ?',
  'WHERE "userId" = ? AND "asset" = ? AND changes() = 1 AND CAST(? AS INTEGER) > 0',
  'AND "version" < 2147483647',
  'AND ((? = "CREDIT" AND "balance" <= 9223372036854775807 - CAST(? AS INTEGER))',
  'OR (? = "DEBIT" AND "balance" >= CAST(? AS INTEGER)))'
].join(" ");

const INSERT_GUARD = "INSERT INTO fe_write_guard (assertion) VALUES (changes())";
const CLEAR_GUARD = "DELETE FROM fe_write_guard";

export class WalletLedgerRepository {
  constructor(private readonly db: WalletLedgerD1Database) {}

  async applyDelta(input: WalletDeltaInput): Promise<{ status: "applied" | "duplicate" }> {
    this.validateInput(input);
    const amountText = toD1Integer(input.amount);
    const amount = BigInt(amountText);
    if (amount <= 0n) throw new RangeError("Wallet delta amount must be greater than zero");

    const createdAt = input.createdAt ?? new Date().toISOString();
    try {
      const results = await this.db.batch([
        this.db.prepare(INSERT_LEDGER).bind(
          input.id, input.idempotencyKey, input.userId, input.asset, input.direction,
          amountText, input.reason, input.referenceType ?? null, input.referenceId ?? null, createdAt
        ),
        this.db.prepare(UPDATE_WALLET).bind(
          input.direction, amountText, amountText, createdAt, input.userId, input.asset,
          amountText, input.direction, amountText, input.direction, amountText
        ),
        this.db.prepare(INSERT_GUARD),
        this.db.prepare(CLEAR_GUARD)
      ]);

      if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) {
        throw new Error("D1 wallet batch completed without applying exactly one ledger row and wallet update");
      }
      return { status: "applied" };
    } catch (batchError) {
      let existing: ExistingLedgerRow | null;
      try {
        existing = await this.findLedgerByIdempotencyKey(input.idempotencyKey);
      } catch {
        throw batchError;
      }
      if (existing) {
        if (this.matchesExisting(existing, input, amountText)) return { status: "duplicate" };
        throw new IdempotencyConflictError();
      }

      let wallet: WalletRow | null;
      try {
        wallet = await this.findWallet(input.userId, input.asset);
      } catch {
        throw batchError;
      }
      if (!wallet) throw new WalletNotFoundError();
      if (wallet.version >= SQLITE_INT32_MAX) throw new WalletVersionOverflowError();

      const balance = fromD1Integer(wallet.balance);
      if (balance === null) throw new WalletNotFoundError();
      if (input.direction === "DEBIT" && balance < amount) throw new InsufficientFundsError();
      if (input.direction === "CREDIT" && balance > SQLITE_INT64_MAX - amount) {
        throw new WalletBalanceOverflowError();
      }
      throw batchError;
    }
  }

  async getBalance(userId: string, asset: WalletAsset): Promise<bigint> {
    const wallet = await this.findWallet(userId, asset);
    if (!wallet) throw new WalletNotFoundError();
    const balance = fromD1Integer(wallet.balance);
    if (balance === null) throw new WalletNotFoundError();
    return balance;
  }

  private validateInput(input: WalletDeltaInput): void {
    for (const [name, value] of [
      ["id", input.id],
      ["idempotencyKey", input.idempotencyKey],
      ["userId", input.userId],
      ["reason", input.reason]
    ] as const) {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError(name + " must be a non-empty string");
      }
    }
    if (input.asset !== "CASH" && input.asset !== "GOLD") throw new TypeError("Unsupported wallet asset");
    if (input.direction !== "CREDIT" && input.direction !== "DEBIT") throw new TypeError("Unsupported ledger direction");
  }

  private async findLedgerByIdempotencyKey(key: string): Promise<ExistingLedgerRow | null> {
    return this.db.prepare(
      'SELECT "userId", "asset", "direction", CAST("amount" AS TEXT) AS "amount", "reason", "referenceType", "referenceId" ' +
      'FROM "LedgerTransaction" WHERE "idempotencyKey" = ? LIMIT 1'
    ).bind(key).first<ExistingLedgerRow>();
  }

  private async findWallet(userId: string, asset: WalletAsset): Promise<WalletRow | null> {
    return this.db.prepare(
      'SELECT CAST("balance" AS TEXT) AS "balance", "version" FROM "Wallet" WHERE "userId" = ? AND "asset" = ? LIMIT 1'
    ).bind(userId, asset).first<WalletRow>();
  }

  private matchesExisting(existing: ExistingLedgerRow, input: WalletDeltaInput, amountText: string): boolean {
    return existing.userId === input.userId &&
      existing.asset === input.asset &&
      existing.direction === input.direction &&
      existing.amount === amountText &&
      existing.reason === input.reason &&
      existing.referenceType === (input.referenceType ?? null) &&
      existing.referenceId === (input.referenceId ?? null);
  }
}
