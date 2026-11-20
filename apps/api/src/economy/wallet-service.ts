import { assertIdempotencyKey } from "@football/domain";
import { getWalletEntryPort, type WalletAssetCode, type WalletDirectionCode } from "./wallet-entry-context.js";

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
  asset: WalletAssetCode;
  direction: WalletDirectionCode;
  amount: bigint;
  idempotencyKey: string;
  reason: string;
  referenceType?: string;
  referenceId?: string;
}

/** Wallet balance and ledger entry are committed atomically by the Supabase RPC. */
export async function applyWalletEntry(input: WalletEntryInput) {
  try {
    assertIdempotencyKey(input.idempotencyKey);
  } catch (error) {
    throw new WalletOperationError(error instanceof Error ? error.message : "Invalid idempotency key", "INVALID_AMOUNT");
  }

  const walletPort = getWalletEntryPort();
  if (!walletPort) {
    throw new WalletOperationError("Supabase wallet entry port is unavailable", "SUPABASE_WALLET_ENTRY_UNAVAILABLE");
  }

  try {
    return await walletPort.applyWalletEntry(input);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : error instanceof Error ? error.message : "";
    if (["INVALID_AMOUNT", "INSUFFICIENT_FUNDS", "IDEMPOTENCY_CONFLICT", "WALLET_NOT_FOUND", "CONCURRENT_MODIFICATION"].includes(code)) {
      throw new WalletOperationError(error instanceof Error ? error.message : code, code as WalletOperationError["code"]);
    }
    throw error;
  }
}
