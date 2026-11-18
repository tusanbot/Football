import type { ClubEconomySettlement, ClubEconomySettlementPort } from "../../../../apps/api/src/game/club-economy-settlement-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseClubEconomySettlementRepository implements ClubEconomySettlementPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async settle(userId: string, now: Date): Promise<ClubEconomySettlement> {
    const result = await this.client.rpc<ClubEconomySettlement>("settle_club_economy", {
      p_user_id: userId, p_now: now.toISOString(),
    });
    if (!result || typeof result !== "object" || !Number.isInteger(result.elapsedDays) || result.elapsedDays < 0
      || !["sponsorIncome", "operatingCost", "paid", "arrears"].every((key) =>
        typeof (result as Record<string, unknown>)[key] === "string"
        && /^\d+$/.test((result as Record<string, string>)[key]!))) {
      throw new Error("SUPABASE_CLUB_ECONOMY_SETTLEMENT_INVALID_RESPONSE");
    }
    return result;
  }
}
