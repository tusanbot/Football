import type { PublicPlayerRecord, PublicPlayerRecordMetric, PublicPlayerRecordRepository } from "./public-record-routes.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";

export class NodeSupabasePublicPlayerRecordRepository implements PublicPlayerRecordRepository {
  constructor(private readonly client: SupabaseHttpClient) {}
  async list(metric: PublicPlayerRecordMetric, limit: number): Promise<PublicPlayerRecord[]> {
    const rows = await this.client.rpc<PublicPlayerRecord[]>("get_public_player_records_http", {
      p_metric: metric,
      p_limit: limit,
    });
    if (!Array.isArray(rows)) throw new Error("INVALID_PUBLIC_PLAYER_RECORD_RESPONSE");
    return rows.map((row) => ({
      ...row,
      overall: Number(row.overall),
      appearances: Number(row.appearances),
      goals: Number(row.goals),
      assists: Number(row.assists),
      minutesPlayed: Number(row.minutesPlayed),
      averageRating: Number(row.averageRating),
      value: Number(row.value),
    }));
  }
}
