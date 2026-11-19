import type { SupabaseHttpClient } from "../supabase-http.js";

export interface SpecialPlayerCatalogRepository {
  listActive(): Promise<unknown[]>;
}

export class SupabaseSpecialPlayerCatalogRepository implements SpecialPlayerCatalogRepository {
  constructor(private readonly client: SupabaseHttpClient) {}

  async listActive(): Promise<unknown[]> {
    const rows = await this.client.rpc<unknown>("get_active_special_players", {});
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error("SUPABASE_SPECIAL_PLAYER_CATALOG_INVALID_RESPONSE");
    }
    return rows;
  }
}
