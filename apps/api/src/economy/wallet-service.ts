import { Prisma, type WalletAsset, type LedgerDirection } from "@prisma/client";
import { assertIdempotencyKey, calculateNextBalance } from "@football/domain";
import { prisma } from "../db.js";
import { getWalletEntryPort } from "./wallet-entry-context.js";

export class WalletOperationError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_AMOUNT" | "INSUFFICIENT_FUNDS" | "IDEMPOTENCY_CONFLICT" | "WALLET_NOT_FOUND" | "CONCURRENT_MODIFICATION",
  ) {
    super(message);
    this.name = "WalletOperationError";
  }
}

export interface WalletEntryInput {
  userId: string;
  asset: WalletAsset;
  direction: LedgerDirection;
  amount: bigint;
  idempotencyKey: string;
  reason: string;
  referenceType?: string;
  referenceId?: string;
}

/**
 * The ledger row and wallet balance are committed together.
 * Cloudflare requests provide an RPC port so this command executes in one PostgreSQL transaction.
 */
export async function applyWalletEntry(input: WalletEntryInput) {
  try {
    try { assertIdempotencyKey(input.idempotencyKey); }
    catch (error) { throw new WalletOperationError(error instanceof Error ? error.message : "Invalid idempotency key", "INVALID_AMOUNT"); }

    const walletPort = getWalletEntryPort();
    if (walletPort) {
      try {
        return await walletPort.applyWalletEntry(input);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (["INVALID_AMOUNT", "INSUFFICIENT_FUNDS", "IDEMPOTENCY_CONFLICT", "WALLET_NOT_FOUND", "CONCURRENT_MODIFICATION"].includes(code)) {
          throw new WalletOperationError(error instanceof Error ? error.message : code, code as WalletOperationError["code"]);
        }
        throw error;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });

      if (previous) {
        const sameCommand =
          previous.userId === input.userId &&
          previous.asset === input.asset &&
          previous.direction === input.direction &&
          previous.amount === input.amount &&
          previous.reason === input.reason &&
          previous.referenceType === (input.referenceType ?? null) &&
          previous.referenceId === (input.referenceId ?? null);
        if (!sameCommand) throw new WalletOperationError("Idempotency key already used for another command", "IDEMPOTENCY_CONFLICT");
        const wallet = await tx.wallet.findUnique({
          where: { userId_asset: { userId: input.userId, asset: input.asset } },
          select: { balance: true, version: true },
        });
        if (!wallet) throw new WalletOperationError("Wallet not found", "WALLET_NOT_FOUND");
        return { ledgerId: previous.id, balance: wallet.balance, version: wallet.version, replayed: true };
      }

      const wallet = await tx.wallet.findUnique({
        where: { userId_asset: { userId: input.userId, asset: input.asset } },
        select: { id: true, balance: true, version: true },
      });
      if (!wallet) throw new WalletOperationError("Wallet not found", "WALLET_NOT_FOUND");

      let nextBalance: bigint;
      try {
        nextBalance = calculateNextBalance(wallet.balance, input.direction, input.amount);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid wallet amount";
        const code = message === "Insufficient funds" ? "INSUFFICIENT_FUNDS" : "INVALID_AMOUNT";
        throw new WalletOperationError(message, code);
      }

      const updated = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
        data: { balance: nextBalance, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new WalletOperationError("Wallet changed concurrently; retry the command", "CONCURRENT_MODIFICATION");
      }

      const ledger = await tx.ledgerTransaction.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          userId: input.userId,
          asset: input.asset,
          direction: input.direction,
          amount: input.amount,
          reason: input.reason,
          ...(input.referenceType ? { referenceType: input.referenceType } : {}),
          ...(input.referenceId ? { referenceId: input.referenceId } : {}),
        },
        select: { id: true },
      });

      return { ledgerId: ledger.id, balance: nextBalance, version: wallet.version + 1, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { ...result, balance: result.balance.toString() };
  } catch (error) {
    if (error instanceof WalletOperationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new WalletOperationError("Idempotency key already used; retry with the original command", "IDEMPOTENCY_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new WalletOperationError("Wallet changed concurrently; retry the command", "CONCURRENT_MODIFICATION");
    }
    throw error;
  }
}
