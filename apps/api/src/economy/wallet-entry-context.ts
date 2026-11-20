import { AsyncLocalStorage } from "node:async_hooks";

export type WalletAssetCode = "CASH" | "GOLD" | "HONOR";
export type WalletDirectionCode = "CREDIT" | "DEBIT";

export interface WalletEntryCommand {
  userId: string;
  asset: WalletAssetCode;
  direction: WalletDirectionCode;
  amount: bigint;
  idempotencyKey: string;
  reason: string;
  referenceType?: string;
  referenceId?: string;
}

export interface WalletEntryResult {
  ledgerId: string;
  balance: string;
  version: number;
  replayed: boolean;
}

export interface WalletEntryPort {
  applyWalletEntry(input: WalletEntryCommand): Promise<WalletEntryResult>;
}

const walletEntryScope = new AsyncLocalStorage<WalletEntryPort>();

export function withWalletEntryPort<T>(port: WalletEntryPort, operation: () => T): T {
  return walletEntryScope.run(port, operation);
}

export function getWalletEntryPort(): WalletEntryPort | undefined {
  const port = walletEntryScope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("WALLET_ENTRY_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
