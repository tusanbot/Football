import type { SeasonAwardData, SeasonAwardRepository } from "../../../../apps/api/src/game/season-award-routes.js";
import type { SupabaseHttpClient } from "../supabase-http.js";

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SUPABASE_SEASON_AWARDS_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error("SUPABASE_SEASON_AWARDS_INVALID_" + field.toUpperCase());
  return value;
}
function numberValue(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error("SUPABASE_SEASON_AWARDS_INVALID_" + field.toUpperCase());
  return parsed;
}
function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value, field);
}
export class SupabaseSeasonAwardRepository implements SeasonAwardRepository {
  constructor(private readonly client: SupabaseHttpClient) {}
  async getSeasonData(season: number): Promise<SeasonAwardData> {
    const raw = objectValue(await this.client.rpc<unknown>("get_season_award_data", { p_season: season }));
    if (!Array.isArray(raw.records) || !Array.isArray(raw.manualAwards)) throw new Error("SUPABASE_SEASON_AWARDS_INVALID_RESPONSE");
    const records = raw.records.map((item) => {
      const row = objectValue(item);
      return {
        playerId: stringValue(row.playerId, "player_id"), playerName: stringValue(row.playerName, "player_name"),
        position: stringValue(row.position, "position"), clubName: stringValue(row.clubName, "club_name"),
        appearances: numberValue(row.appearances, "appearances"), goals: numberValue(row.goals, "goals"),
        assists: numberValue(row.assists, "assists"), minutesPlayed: numberValue(row.minutesPlayed, "minutes_played"),
        averageRating: numberValue(row.averageRating, "average_rating"),
      };
    });
    const manualAwards = raw.manualAwards.map((item) => {
      const row = objectValue(item);
      return {
        id: stringValue(row.id, "award_id"), awardType: stringValue(row.awardType, "award_type"),
        awardName: stringValue(row.awardName, "award_name"), reason: nullableString(row.reason, "reason"),
        playerId: stringValue(row.playerId, "player_id"), playerName: stringValue(row.playerName, "player_name"),
        position: stringValue(row.position, "position"), clubName: stringValue(row.clubName, "club_name"),
      };
    });
    return { matches: numberValue(raw.matches, "matches"), records, manualAwards };
  }
}
