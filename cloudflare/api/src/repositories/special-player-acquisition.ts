import { fromD1Integer, toD1Integer } from "../d1-integer.js";

export interface SpecialAcquisitionStatement {
  bind(...values: unknown[]): SpecialAcquisitionStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface SpecialAcquisitionD1Database {
  prepare(query: string): SpecialAcquisitionStatement;
  batch(statements: SpecialAcquisitionStatement[]): Promise<Array<{ meta?: { changes?: number } }>>;
}

export class SpecialPlayerUnavailableError extends Error {
  constructor() { super("Special player is unavailable for this acquisition method"); this.name = "SpecialPlayerUnavailableError"; }
}
export class SpecialPlayerAlreadyOwnedError extends Error {
  constructor() { super("This special player is already owned by the club"); this.name = "SpecialPlayerAlreadyOwnedError"; }
}
export class SpecialPlayerInsufficientFundsError extends Error {
  constructor() { super("Insufficient wallet balance for special player acquisition"); this.name = "SpecialPlayerInsufficientFundsError"; }
}
export class SpecialPlayerWalletNotFoundError extends Error {
  constructor() { super("Wallet does not exist for the selected asset"); this.name = "SpecialPlayerWalletNotFoundError"; }
}
export class SpecialPlayerAcquisitionConflictError extends Error {
  constructor() { super("Idempotency key was already used for a different acquisition"); this.name = "SpecialPlayerAcquisitionConflictError"; }
}
export class SpecialPlayerAcquisitionOverflowError extends Error {
  constructor() { super("Wallet balance or version cannot be safely updated"); this.name = "SpecialPlayerAcquisitionOverflowError"; }
}

const MAX_VERSION = 2_147_483_647;
const GUARD = "INSERT INTO fe_write_guard (assertion) VALUES (changes())";
const CLEAR_GUARD = "DELETE FROM fe_write_guard";

export interface SpecialPlayerAcquisitionInput {
  id: string;
  playerId: string;
  ledgerId: string;
  idempotencyKey: string;
  userId: string;
  clubId: string;
  specialPlayerId: string;
  asset: "CASH" | "GOLD";
  amount: bigint | string | number;
  method: string;
  position: string;
  firstName: string;
  lastName: string;
  contractDays?: number;
  now?: string;
}

interface CatalogRow {
  id: string;
  fullName: string;
  nationality: string;
  birthDate: string | null;
  positions: string;
  rarity: string;
  acquisitionMethods: string;
  overall: number;
  potential: number;
  attributes: string;
}
interface ExistingAcquisition {
  idempotencyKey: string;
  userId: string;
  clubId: string;
  specialPlayerId: string;
  playerId: string;
  method: string;
  asset: string;
  amount: string;
  position: string;
}
interface WalletRow { balance: string; version: number; }

export class SpecialPlayerAcquisitionRepository {
  constructor(private readonly db: SpecialAcquisitionD1Database) {}

  async acquire(input: SpecialPlayerAcquisitionInput): Promise<{ status: "acquired" | "duplicate"; playerId: string }> {
    for (const [key, value] of Object.entries(input)) {
      if (key === "amount" || key === "contractDays" || key === "now") continue;
      if (typeof value !== "string" || value.trim() === "") throw new TypeError(key + " must be a non-empty string");
    }
    if (input.idempotencyKey.length < 12 || input.idempotencyKey.length > 128) throw new TypeError("idempotencyKey length is invalid");
    if (input.asset !== "CASH" && input.asset !== "GOLD") throw new TypeError("asset must be CASH or GOLD");
    if (!Number.isInteger(input.contractDays ?? 365) || (input.contractDays ?? 365) < 1 || (input.contractDays ?? 365) > 3650) {
      throw new RangeError("contractDays must be between 1 and 3650");
    }
    const amountText = toD1Integer(input.amount);
    const amount = BigInt(amountText);
    if (amount <= 0n) throw new RangeError("Acquisition price must be positive");
    const now = input.now ?? new Date().toISOString();

    const prior = await this.findByKey(input.idempotencyKey);
    if (prior) return this.verifyReplay(prior, input, amountText);

    const catalog = await this.findCatalog(input.specialPlayerId);
    if (!catalog || !catalog.active) throw new SpecialPlayerUnavailableError();
    if (!JSON.parse(catalog.positions).includes(input.position) ||
        !JSON.parse(catalog.acquisitionMethods).includes(input.method)) {
      throw new SpecialPlayerUnavailableError();
    }
    const club = await this.db.prepare(
      'SELECT "id" FROM "Club" WHERE "id" = ? AND "ownerId" = ? LIMIT 1'
    ).bind(input.clubId, input.userId).first<{ id: string }>();
    if (!club) throw new SpecialPlayerUnavailableError();

    const existingPlayer = await this.db.prepare(
      'SELECT "id" FROM "Player" WHERE "clubId" = ? AND "specialPlayerId" = ? LIMIT 1'
    ).bind(input.clubId, input.specialPlayerId).first<{ id: string }>();
    if (existingPlayer) throw new SpecialPlayerAlreadyOwnedError();

    const wallet = await this.findWallet(input.userId, input.asset);
    if (!wallet) throw new SpecialPlayerWalletNotFoundError();
    const balance = fromD1Integer(wallet.balance);
    if (balance === null) throw new SpecialPlayerWalletNotFoundError();
    if (balance < amount) throw new SpecialPlayerInsufficientFundsError();
    if (wallet.version >= MAX_VERSION) throw new SpecialPlayerAcquisitionOverflowError();

    const wage = BigInt(catalog.overall) * BigInt(catalog.overall) * 2n;
    const wageText = toD1Integer(wage);
    const contractDays = input.contractDays ?? 365;
    const statements = [
      this.db.prepare(
        'INSERT INTO "LedgerTransaction" ("id", "idempotencyKey", "userId", "asset", "direction", "amount", "reason", "referenceType", "referenceId", "createdAt") ' +
        'VALUES (?, ?, ?, ?, \'DEBIT\', CAST(? AS INTEGER), \'SPECIAL_PLAYER_ACQUISITION\', \'SpecialPlayer\', ?, ?) ON CONFLICT("idempotencyKey") DO NOTHING'
      ).bind(input.ledgerId, input.idempotencyKey + ":ledger", input.userId, input.asset, amountText, input.specialPlayerId, now),
      this.db.prepare(GUARD),
      this.db.prepare(
        'UPDATE "Wallet" SET "balance" = "balance" - CAST(? AS INTEGER), "version" = "version" + 1, "updatedAt" = ? ' +
        'WHERE "userId" = ? AND "asset" = ? AND changes() = 1 AND "balance" >= CAST(? AS INTEGER) AND "version" < 2147483647'
      ).bind(amountText, now, input.userId, input.asset, amountText),
      this.db.prepare(GUARD),
      this.db.prepare(
        'INSERT INTO "Player" ("id", "clubId", "firstName", "lastName", "nationality", "age", "position", "overall", "potential", "marketValue", "attributes", "wage", "contractDays", "morale", "fitness", "origin", "status", "lineupSlot", "ageDays", "trainingFocus", "specialPlayerId", "createdAt", "updatedAt") ' +
        'SELECT ?, ?, ?, ?, s."nationality", CASE WHEN s."birthDate" IS NULL THEN 25 ELSE MAX(1, CAST((julianday(?) - julianday(s."birthDate")) / 365.2425 AS INTEGER)) END, ?, s."overall", s."potential", CAST(? AS INTEGER), s."attributes", CAST(? AS INTEGER), ?, 75, 100, \'SPECIAL\', \'ACTIVE\', NULL, 0, \'BALANCED\', s."id", ?, ? ' +
        'FROM "SpecialPlayer" s JOIN "Club" c ON c."id" = ? AND c."ownerId" = ? ' +
        'WHERE s."id" = ? AND s."active" = 1 AND EXISTS (SELECT 1 FROM json_each(s."positions") WHERE value = ?) ' +
        'AND EXISTS (SELECT 1 FROM json_each(s."acquisitionMethods") WHERE value = ?) ' +
        'AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p."clubId" = c."id" AND p."specialPlayerId" = s."id") AND changes() = 1'
      ).bind(input.playerId, input.clubId, input.firstName.trim(), input.lastName.trim(), now, input.position, amountText, wageText,
        contractDays, now, now, input.clubId, input.userId, input.specialPlayerId, input.position, input.method),
      this.db.prepare(GUARD),
      this.db.prepare(
        'INSERT INTO "SpecialPlayerAcquisition" ("id", "idempotencyKey", "userId", "clubId", "specialPlayerId", "playerId", "method", "asset", "amount", "createdAt") ' +
        'SELECT ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS INTEGER), ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM "Player" WHERE "id" = ? AND "clubId" = ? AND "specialPlayerId" = ?) ' +
        'ON CONFLICT("idempotencyKey") DO NOTHING'
      ).bind(input.id, input.idempotencyKey, input.userId, input.clubId, input.specialPlayerId, input.playerId, input.method,
        input.asset, amountText, now, input.playerId, input.clubId, input.specialPlayerId),
      this.db.prepare(GUARD),
      this.db.prepare(CLEAR_GUARD),
    ];

    try {
      const results = await this.db.batch(statements);
      for (const index of [0, 2, 4, 6]) {
        if (results[index]?.meta?.changes !== 1) throw new Error("D1 special-player acquisition did not apply every required mutation");
      }
      return { status: "acquired", playerId: input.playerId };
    } catch (error) {
      const replay = await this.findByKey(input.idempotencyKey).catch(() => null);
      if (replay) return this.verifyReplay(replay, input, amountText);
      const duplicate = await this.db.prepare(
        'SELECT "id" FROM "Player" WHERE "clubId" = ? AND "specialPlayerId" = ? LIMIT 1'
      ).bind(input.clubId, input.specialPlayerId).first<{ id: string }>().catch(() => null);
      if (duplicate) throw new SpecialPlayerAlreadyOwnedError();
      const latestWallet = await this.findWallet(input.userId, input.asset).catch(() => null);
      if (!latestWallet) throw new SpecialPlayerWalletNotFoundError();
      const latestBalance = fromD1Integer(latestWallet.balance);
      if (latestBalance !== null && latestBalance < amount) throw new SpecialPlayerInsufficientFundsError();
      if (latestWallet.version >= MAX_VERSION) throw new SpecialPlayerAcquisitionOverflowError();
      throw error;
    }
  }

  private async findCatalog(id: string): Promise<(CatalogRow & { active: number }) | null> {
    return this.db.prepare(
      'SELECT "id", "fullName", "nationality", "birthDate", "positions", "rarity", "acquisitionMethods", "overall", "potential", "attributes", "active" FROM "SpecialPlayer" WHERE "id" = ? LIMIT 1'
    ).bind(id).first<CatalogRow & { active: number }>();
  }
  private async findWallet(userId: string, asset: string): Promise<WalletRow | null> {
    return this.db.prepare(
      'SELECT CAST("balance" AS TEXT) AS "balance", "version" FROM "Wallet" WHERE "userId" = ? AND "asset" = ? LIMIT 1'
    ).bind(userId, asset).first<WalletRow>();
  }
  private async findByKey(key: string): Promise<ExistingAcquisition | null> {
    return this.db.prepare(
      'SELECT a."idempotencyKey", a."userId", a."clubId", a."specialPlayerId", a."playerId", a."method", a."asset", CAST(a."amount" AS TEXT) AS "amount", p."position" FROM "SpecialPlayerAcquisition" a JOIN "Player" p ON p."id" = a."playerId" WHERE a."idempotencyKey" = ? LIMIT 1'
    ).bind(key).first<ExistingAcquisition>();
  }
  private verifyReplay(prior: ExistingAcquisition, input: SpecialPlayerAcquisitionInput, amount: string): { status: "duplicate"; playerId: string } {
    if (prior.userId !== input.userId || prior.clubId !== input.clubId || prior.specialPlayerId !== input.specialPlayerId ||
        prior.playerId !== input.playerId || prior.method !== input.method || prior.asset !== input.asset ||
        prior.amount !== amount || prior.position !== input.position) throw new SpecialPlayerAcquisitionConflictError();
    return { status: "duplicate", playerId: prior.playerId };
  }
}
