import type { FastifyInstance } from "fastify";
import { z } from "zod";

const querySchema = z.object({
  metric: z.enum(["goals", "assists", "appearances", "rating"]).default("goals"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export type PublicPlayerRecordMetric = "goals" | "assists" | "appearances" | "rating";
export interface PublicPlayerRecord {
  playerId: string;
  playerName: string;
  position: string;
  overall: number;
  clubName: string;
  appearances: number;
  goals: number;
  assists: number;
  minutesPlayed: number;
  averageRating: number;
  value: number;
}
export interface PublicPlayerRecordRepository {
  list(metric: PublicPlayerRecordMetric, limit: number): Promise<PublicPlayerRecord[]>;
}


export function registerPublicPlayerRecordRoutes(
  app: FastifyInstance,
  repository?: PublicPlayerRecordRepository,
) {
  app.get("/v1/players/records", async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_PLAYER_RECORD_QUERY" });
    if (!repository) return reply.code(503).send({ error: "SUPABASE_PUBLIC_PLAYER_RECORDS_UNAVAILABLE" });
    const records = await repository.list(query.data.metric, query.data.limit);
    return {
      metric: query.data.metric,
      minimumAppearances: query.data.metric === "rating" ? 3 : 1,
      records: records.map((record, index) => ({ rank: index + 1, ...record })),
    };
  });
}
