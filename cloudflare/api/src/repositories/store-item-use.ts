import type { StoreItemUseCommand, StoreItemUsePort, StoreItemUseResult } from "../../../../apps/api/src/store/store-item-use-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../supabase-http.js";

interface StoreItemUseRpcRow {
  item_key: string;
  player_id: string;
  inventory: number;
  fitness: number | null;
  morale: number | null;
  replayed: boolean;
}

const STORE_USE_ERROR_CODES = new Set([
  "INVALID_IDEMPOTENCY_KEY",
  "INVALID_STORE_ITEM_EFFECT",
  "STORE_ITEM_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "CLUB_NOT_FOUND",
  "PLAYER_NOT_FOUND",
  "PLAYER_STAT_ALREADY_MAX",
  "ITEM_NOT_IN_INVENTORY",
  "CONCURRENT_MODIFICATION",
]);

export class SupabaseStoreItemUseRepository implements StoreItemUsePort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async use(input: StoreItemUseCommand): Promise<StoreItemUseResult> {
    let rows: StoreItemUseRpcRow[];
    try {
      rows = await this.client.rpc<StoreItemUseRpcRow[]>("use_store_item", {
        p_user_id: input.userId,
        p_item_key: input.itemKey,
        p_player_id: input.playerId,
        p_fitness_delta: input.fitnessDelta,
        p_morale_delta: input.moraleDelta,
        p_idempotency_key: input.idempotencyKey,
      });
    } catch (error) {
      const message = error instanceof SupabaseHttpError ? error.message : error instanceof Error ? error.message : "";
      const code = [...STORE_USE_ERROR_CODES].find((candidate) => message.includes(candidate));
      if (code) throw Object.assign(new Error(message), { code });
      throw error;
    }

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || row.item_key !== input.itemKey || row.player_id !== input.playerId
      || !Number.isInteger(row.inventory) || typeof row.replayed !== "boolean"
      || (!row.replayed && (!Number.isInteger(row.fitness) || !Number.isInteger(row.morale)))) {
      throw new Error("SUPABASE_STORE_ITEM_USE_INVALID_RESPONSE");
    }
    return {
      itemKey: row.item_key,
      playerId: row.player_id,
      inventory: row.inventory,
      ...(Number.isInteger(row.fitness) && Number.isInteger(row.morale)
        ? { player: { fitness: row.fitness as number, morale: row.morale as number } }
        : {}),
      replayed: row.replayed,
    };
  }
}
