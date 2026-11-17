import type { PublicPlayerRecord, PublicPlayerRecordMetric, PublicPlayerRecordRepository } from "../../../apps/api/src/players/public-record-routes.js";
import type { SupabaseHttpClient } from "./supabase-http.js";

interface RpcPlayerRecord {
  playerId: unknown;
  playerName: unknown;
  position: unknown;
  overall: unknown;
  clubName: unknown;
  appearances: unknown;
  goals: unknown;
  assists: unknown;
  minutesPlayed: unknown;
  averageRating: unknown;
  value: unknown;
}

function finiteNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error("SUPABASE_PLAYER_RECORD_INVALID_" + field.toUpperCase());
  return parsed;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error("SUPABASE_PLAYER_RECORD_INVALID_" + field.toUpperCase());
  return value;
}

export class SupabasePublicPlayerRecordRepository implements PublicPlayerRecordRepository {
  constructor(private readonly client: SupabaseHttpClient) {}

  async list(metric: PublicPlayerRecordMetric, limit: number): Promise<PublicPlayerRecord[]> {
    const rows = await this.client.rpc<RpcPlayerRecord[]>("get_public_player_records", {
      p_metric: metric,
      p_limit: limit,
    });
    if (!Array.isArray(rows)) throw new Error("SUPABASE_PLAYER_RECORD_INVALID_RESPONSE");
    return rows.map((row) => ({
      playerId: requiredString(row.playerId, "player_id"),
      playerName: requiredString(row.playerName, "player_name"),
      position: requiredString(row.position, "position"),
      overall: finiteNumber(row.overall, "overall"),
      clubName: requiredString(row.clubName, "club_name"),
      appearances: finiteNumber(row.appearances, "appearances"),
      goals: finiteNumber(row.goals, "goals"),
      assists: finiteNumber(row.assists, "assists"),
      minutesPlayed: finiteNumber(row.minutesPlayed, "minutes_played"),
      averageRating: finiteNumber(row.averageRating, "average_rating"),
      value: finiteNumber(row.value, "value"),
    }));
  }
}
