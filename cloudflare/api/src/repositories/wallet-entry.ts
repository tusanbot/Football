import type { WalletEntryCommand, WalletEntryPort, WalletEntryResult } from "../../../apps/api/src/economy/wallet-entry-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../supabase-http.js";

interface WalletEntryRpcRow {
  ledger_id: string;
  balance: string;
  version: number;
  replayed: boolean;
}

const WALLET_ERROR_CODES = new Set([
  "INVALID_AMOUNT",
  "INSUFFICIENT_FUNDS",
  "IDEMPOTENCY_CONFLICT",
  "WALLET_NOT_FOUND",
  "CONCURRENT_MODIFICATION",
]);

export class SupabaseWalletEntryRepository implements WalletEntryPort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async applyWalletEntry(input: WalletEntryCommand): Promise<WalletEntryResult> {
    let rows: WalletEntryRpcRow[];
    try {
      rows = await this.client.rpc<WalletEntryRpcRow[]>("apply_wallet_entry", {
        p_user_id: input.userId,
        p_asset: input.asset,
        p_direction: input.direction,
        p_amount: input.amount.toString(),
        p_idempotency_key: input.idempotencyKey,
        p_reason: input.reason,
        p_reference_type: input.referenceType ?? null,
        p_reference_id: input.referenceId ?? null,
      });
    } catch (error) {
      const message = error instanceof SupabaseHttpError ? error.message : error instanceof Error ? error.message : "";
      const code = [...WALLET_ERROR_CODES].find((candidate) => message.includes(candidate));
      if (code) throw Object.assign(new Error(message), { code });
      throw error;
    }

    const row = rows[0];
    if (!row || typeof row.ledger_id !== "string" || typeof row.balance !== "string" || !/^-?\d+$/.test(row.balance) || !Number.isInteger(row.version)) {
      throw new Error("SUPABASE_WALLET_RPC_INVALID_RESPONSE");
    }
    return {
      ledgerId: row.ledger_id,
      balance: row.balance,
      version: row.version,
      replayed: row.replayed === true,
    };
  }
}
