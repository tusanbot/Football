import type { ClubEconomySettlement, ClubEconomySettlementPort } from "./club-economy-settlement-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";

export class NodeSupabaseClubEconomyRepository implements ClubEconomySettlementPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async settle(userId: string, now: Date): Promise<ClubEconomySettlement> {
    const result = await this.client.rpc<ClubEconomySettlement>("settle_club_economy", {
      p_user_id: userId,
      p_now: now.toISOString(),
    });
    if (!result || typeof result !== "object" || !Number.isInteger(result.elapsedDays) || result.elapsedDays < 0
      || ![result.sponsorIncome, result.operatingCost, result.paid, result.arrears].every((value) =>
        typeof value === "string" && /^\d+$/.test(value))) {
      throw new Error("SUPABASE_CLUB_ECONOMY_SETTLEMENT_INVALID_RESPONSE");
    }
    return result;
  }
}
