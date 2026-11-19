import type { FootballMatch } from "@prisma/client";
import type { FriendlyMatchCreationPort } from "../../../../apps/api/src/game/friendly-match-creation-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../supabase-http.js";

interface CreateFriendlyMatchResult { match: Record<string, unknown>; replayed: boolean; }
const MATCH_FIELDS = [
  "id", "idempotencyKey", "type", "status", "homeClubId", "awayClubId", "competitionId",
  "rulesSnapshot", "tieId", "leg", "round", "scheduledAt", "startedAt", "completedAt", "seed",
  "simulationVersion", "homeScore", "awayScore", "homePenalties", "awayPenalties", "winnerClubId",
  "attendance", "ticketRevenue", "homeExpectedGoals", "awayExpectedGoals", "createdAt", "updatedAt",
] as const;

export class SupabaseFriendlyMatchCreationRepository implements FriendlyMatchCreationPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async create(userId: string, opponentClubId: string, idempotencyKey: string, scheduledAt: Date) {
    let result: CreateFriendlyMatchResult;
    try {
      result = await this.client.rpc<CreateFriendlyMatchResult>("create_friendly_match_http", {
        p_user_id: userId, p_opponent_club_id: opponentClubId,
        p_idempotency_key: idempotencyKey, p_scheduled_at: scheduledAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof SupabaseHttpError && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) {
        throw new Error(error.message);
      }
      throw error;
    }
    if (!result || typeof result !== "object" || typeof result.replayed !== "boolean"
      || !result.match || typeof result.match !== "object"
      || MATCH_FIELDS.some((field) => !(field in result.match))) {
      throw new Error("SUPABASE_FRIENDLY_MATCH_INVALID_RESPONSE");
    }
    const row = result.match;
    if (typeof row.id !== "string" || typeof row.idempotencyKey !== "string"
      || row.type !== "FRIENDLY" || row.status !== "SCHEDULED"
      || typeof row.homeClubId !== "string" || typeof row.awayClubId !== "string"
      || typeof row.scheduledAt !== "string" || !Number.isFinite(Date.parse(row.scheduledAt))
      || typeof row.seed !== "string" || typeof row.createdAt !== "string" || typeof row.updatedAt !== "string") {
      throw new Error("SUPABASE_FRIENDLY_MATCH_INVALID_RESPONSE");
    }
    return { match: row as unknown as FootballMatch, replayed: result.replayed };
  }
}
