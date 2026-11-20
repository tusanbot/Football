import type { WalletAsset, LedgerDirection } from "@prisma/client";
import { assertIdempotencyKey } from "@football/domain";
import { getWalletEntryPort } from "./wallet-entry-context.js";

export class WalletOperationError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_AMOUNT" | "INSUFFICIENT_FUNDS" | "IDEMPOTENCY_CONFLICT" | "WALLET_NOT_FOUND" | "CONCURRENT_MODIFICATION" | "SUPABASE_WALLET_ENTRY_UNAVAILABLE",
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
    if (!walletPort) throw new WalletOperationError("Supabase wallet entry port is unavailable", "SUPABASE_WALLET_ENTRY_UNAVAILABLE");
    try {
      const result = await walletPort.applyWalletEntry(input);
      return { ...result, balance: result.balance.toString() };
    } catch (error) {
    if (error instanceof WalletOperationError) throw error;
    throw error;
  }
}
