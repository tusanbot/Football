import type { MatchRuntimeSettlementCommand, MatchRuntimeSettlementPort, MatchRuntimeSettlementResult } from "./match-runtime-settlement-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";

export class SupabaseMatchRuntimeSettlementRepository implements MatchRuntimeSettlementPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async settle(input: MatchRuntimeSettlementCommand): Promise<MatchRuntimeSettlementResult> {
    const result = await this.client.rpc<MatchRuntimeSettlementResult>("settle_and_advance_match_runtime_http", {
      p_match_id: input.matchId,
      p_runtime_id: input.runtimeId,
      p_lease_token: input.leaseToken,
      p_now: input.now,
      p_result: input.result,
      p_injury_duration_days: input.injuryDurationDays,
      p_red_card_suspension_matches: input.redCardSuspensionMatches,
      p_yellow_cards_to_suspend: input.yellowCardsToSuspend,
      p_yellow_card_suspension_matches: input.yellowCardSuspensionMatches,
      p_home_reward: input.homeReward,
      p_away_reward: input.awayReward,
    });
    if (!result || typeof result !== "object" || typeof result.matchId !== "string"
      || result.matchId !== input.matchId || typeof result.replayed !== "boolean"
      || !("advancement" in result)) {
      throw new Error("SUPABASE_MATCH_RUNTIME_SETTLEMENT_REJECTED");
    }
    if (result.competitionId && result.round !== null && result.round !== undefined) {
      const advancement = result.advancement;
      if (!advancement || typeof advancement !== "object"
        || advancement.competitionId !== result.competitionId
        || !["LEAGUE", "CUP"].includes(advancement.format)
        || typeof advancement.completed !== "boolean"
        || typeof advancement.roundComplete !== "boolean"
        || typeof advancement.fixturesCreated !== "number"
        || typeof advancement.noticesCreated !== "number"
        || typeof advancement.replayed !== "boolean") {
        throw new Error("SUPABASE_MATCH_RUNTIME_ADVANCEMENT_REJECTED");
      }
    } else if (result.advancement !== null) {
      throw new Error("SUPABASE_MATCH_RUNTIME_ADVANCEMENT_REJECTED");
    }
    return result;
  }
}
