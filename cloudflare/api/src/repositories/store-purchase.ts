import type { StorePurchaseCommand, StorePurchasePort, StorePurchaseResult } from "../../../../apps/api/src/store/store-purchase-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../supabase-http.js";

interface StorePurchaseRpcRow {
  item_key: string;
  purchased_quantity: number;
  balance: string;
  inventory: number;
  replayed: boolean;
}

const STORE_ERROR_CODES = new Set([
  "INVALID_AMOUNT",
  "INVALID_IDEMPOTENCY_KEY",
  "INVALID_QUANTITY",
  "STORE_ITEM_NOT_FOUND",
  "STORE_INVENTORY_OVERFLOW",
  "WALLET_NOT_FOUND",
  "INSUFFICIENT_FUNDS",
  "IDEMPOTENCY_CONFLICT",
  "CONCURRENT_MODIFICATION",
]);

export class SupabaseStorePurchaseRepository implements StorePurchasePort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async purchase(input: StorePurchaseCommand): Promise<StorePurchaseResult> {
    let rows: StorePurchaseRpcRow[];
    try {
      rows = await this.client.rpc<StorePurchaseRpcRow[]>("purchase_store_item", {
        p_user_id: input.userId,
        p_item_key: input.itemKey,
        p_asset: input.asset,
        p_unit_price: input.unitPrice,
        p_quantity: input.quantity,
        p_idempotency_key: input.idempotencyKey,
      });
    } catch (error) {
      const message = error instanceof SupabaseHttpError ? error.message : error instanceof Error ? error.message : "";
      const code = [...STORE_ERROR_CODES].find((candidate) => message.includes(candidate));
      if (code) throw Object.assign(new Error(message), { code });
      throw error;
    }

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || row.item_key !== input.itemKey || row.purchased_quantity !== input.quantity
      || typeof row.balance !== "string" || !/^-?\d+$/.test(row.balance)
      || !Number.isInteger(row.inventory) || typeof row.replayed !== "boolean") {
      throw new Error("SUPABASE_STORE_PURCHASE_INVALID_RESPONSE");
    }
    return {
      itemKey: row.item_key,
      quantity: row.purchased_quantity,
      balance: row.balance,
      inventory: row.inventory,
      replayed: row.replayed,
    };
  }
}
