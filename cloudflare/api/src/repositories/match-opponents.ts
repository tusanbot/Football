import type { MatchOpponent, MatchOpponentPort } from "../../../../apps/api/src/game/match-opponents-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseMatchOpponentRepository implements MatchOpponentPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async list(userId: string, search?: string): Promise<MatchOpponent[]> {
    const result = await this.client.rpc<MatchOpponent[]>("list_match_opponents_http", {
      p_user_id: userId,
      p_search: search?.trim().slice(0, 80) || null,
    });
    if (!Array.isArray(result) || result.some((row) =>
      !row || typeof row.id !== "string" || typeof row.name !== "string"
      || !Number.isInteger(row.level) || !Number.isInteger(row.reputation)
      || typeof row.ownerTelegramId !== "string"
      || (row.ownerUsername !== null && typeof row.ownerUsername !== "string")
      || typeof row.lastActiveAt !== "string" || !Number.isFinite(Date.parse(row.lastActiveAt)))) {
      throw new Error("SUPABASE_MATCH_OPPONENTS_INVALID_RESPONSE");
    }
    return result;
  }
}
