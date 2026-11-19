import type { CompetitionCreationPort } from "../../../../apps/api/src/game/competition-creation-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../supabase-http.js";

const COMPETITION_FIELDS = [
  "id", "idempotencyKey", "name", "season", "format", "status", "maxTeams", "cupLegs",
  "rules", "createdByClubId", "groupId", "allianceId", "allianceSeasonId",
  "startsAt", "completedAt", "createdAt", "updatedAt",
] as const;

export class SupabaseCompetitionCreationRepository implements CompetitionCreationPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async create(input: Parameters<CompetitionCreationPort["create"]>[0]) {
    let result: { competition?: Record<string, unknown>; replayed?: boolean };
    try {
      result = await this.client.rpc("create_competition_http", {
        p_user_id: input.userId,
        p_name: input.name,
        p_max_teams: input.maxTeams,
        p_idempotency_key: input.idempotencyKey,
        p_format: input.format,
        p_cup_legs: input.cupLegs,
        p_season: input.season,
        p_rules: input.rules,
        p_now: input.now.toISOString(),
      });
    } catch (error) {
      if (error instanceof SupabaseHttpError && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) {
        throw new Error(error.message);
      }
      throw error;
    }
    const competition = result?.competition;
    if (!competition || typeof competition !== "object"
      || typeof result.replayed !== "boolean"
      || COMPETITION_FIELDS.some((field) => !(field in competition))
      || typeof competition.id !== "string"
      || typeof competition.idempotencyKey !== "string"
      || typeof competition.createdByClubId !== "string"
      || competition.format !== input.format
      || competition.status !== "REGISTRATION"
      || !Number.isInteger(competition.maxTeams)
      || !Number.isInteger(competition.cupLegs)) {
      throw new Error("SUPABASE_COMPETITION_CREATION_INVALID_RESPONSE");
    }
    return { competition, replayed: result.replayed };
  }
}
