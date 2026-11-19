import type { CompetitionCreationPort } from "./competition-creation-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../node-supabase-http.js";

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
  async updateRules(userId: string, competitionId: string, rules: Record<string, boolean | number>, now: Date) {
    let result: Record<string, unknown>;
    try { result = await this.client.rpc("update_competition_rules_http", { p_user_id: userId, p_competition_id: competitionId, p_rules: rules, p_now: now.toISOString() }); }
    catch (error) { if (error instanceof SupabaseHttpError && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) throw new Error(error.message); throw error; }
    const canonical = (value: unknown) => value && typeof value === "object" ? JSON.stringify(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : "";
    if (!result || result.competitionId !== competitionId || canonical(result.rules) !== canonical(rules)) throw new Error("SUPABASE_COMPETITION_RULES_INVALID_RESPONSE");
    return { competitionId, rules: result.rules };
  }
  async join(userId: string, competitionId: string, now: Date) {
    return this.lifecycleRpc("join_competition_http", {
      p_user_id: userId, p_competition_id: competitionId, p_now: now.toISOString(),
    }, "join");
  }
  async start(userId: string, competitionId: string, now: Date) {
    return this.lifecycleRpc("start_competition_http", {
      p_user_id: userId, p_competition_id: competitionId, p_now: now.toISOString(),
    }, "start");
  }
  private async lifecycleRpc(name: string, args: Record<string, unknown>, operation: "join" | "start") {
    let result: Record<string, unknown>;
    try { result = await this.client.rpc(name, args); }
    catch (error) {
      if (error instanceof SupabaseHttpError && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) throw new Error(error.message);
      throw error;
    }
    const integer = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
    if (!result || typeof result !== "object" || !integer(result.teams)
      || (operation === "join" && (typeof result.joined !== "boolean" || typeof result.replayed !== "boolean" || typeof result.autoStarted !== "boolean"))
      || (operation === "start" && (typeof result.replayed !== "boolean" || !integer(result.fixturesCreated) || !integer(result.rounds)))
      || (result.fixturesCreated !== undefined && !integer(result.fixturesCreated))
      || (result.rounds !== undefined && !integer(result.rounds))
      || (result.autoStarted === true && (typeof result.startsAt !== "string" || !integer(result.fixturesCreated) || !integer(result.rounds)))) {
      throw new Error("SUPABASE_COMPETITION_LIFECYCLE_INVALID_RESPONSE");
    }
    return result;
  }
}
