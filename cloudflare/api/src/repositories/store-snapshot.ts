import type { StoreSnapshot, StoreSnapshotPort } from "../../../../apps/api/src/store/store-snapshot-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseStoreSnapshotRepository implements StoreSnapshotPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async get(userId: string): Promise<StoreSnapshot> {
    const result = await this.client.rpc<unknown>("get_store_snapshot", { p_user_id: userId });
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("SUPABASE_STORE_SNAPSHOT_INVALID_RESPONSE");
    const row = result as Record<string, unknown>;
    if (!Array.isArray(row.wallets) || !Array.isArray(row.inventory) || !Array.isArray(row.specialPlayers)) throw new Error("SUPABASE_STORE_SNAPSHOT_INVALID_RESPONSE");
    return row as unknown as StoreSnapshot;
  }
}
