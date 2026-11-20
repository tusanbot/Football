import type { CompetitionReadPort } from "./competition-read-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../node-supabase-http.js";
import { defaultMatchRules, validateMatchRules } from "@football/domain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function rethrowRpcError(error: unknown): never {
  if (error instanceof SupabaseHttpError && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) throw new Error(error.message);
  throw error;
}
function validCompetitionList(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((row) => isRecord(row)
    && typeof row.id === "string" && typeof row.name === "string"
    && Number.isInteger(row.season) && (row.format === "LEAGUE" || row.format === "CUP")
    && Number.isInteger(row.cupLegs) && (row.status === "REGISTRATION" || row.status === "ACTIVE" || row.status === "COMPLETED" || row.status === "DRAFT" || row.status === "CANCELLED")
    && Number.isInteger(row.maxTeams) && Number.isInteger(row.teams)
    && typeof row.joined === "boolean" && typeof row.isCreator === "boolean" && typeof row.creator === "string");
}
function validCompetitionDetail(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.competition)
    || typeof value.competition.id !== "string" || typeof value.competition.name !== "string"
    || (value.competition.format !== "LEAGUE" && value.competition.format !== "CUP")
    || !Array.isArray(value.standings) || !Array.isArray(value.matches)
    || !Array.isArray(value.nextRoundMatches) || !Array.isArray(value.topScorers)
    || (value.nextRound !== null && !Number.isInteger(value.nextRound))) return false;
  if (value.standings.some((row) => !isRecord(row) || typeof row.clubId !== "string"
    || typeof row.clubName !== "string" || !Number.isInteger(row.position)
    || !Number.isInteger(row.points) || !Number.isInteger(row.played))) return false;
  if (value.matches.some((row) => !isRecord(row) || typeof row.id !== "string"
    || (row.type !== "FRIENDLY" && row.type !== "LEAGUE" && row.type !== "CUP")
    || typeof row.status !== "string" || typeof row.scheduledAt !== "string" || !Number.isFinite(Date.parse(row.scheduledAt))
    || !isRecord(row.homeClub) || typeof row.homeClub.id !== "string" || typeof row.homeClub.name !== "string"
    || !isRecord(row.awayClub) || typeof row.awayClub.id !== "string" || typeof row.awayClub.name !== "string")) return false;
  if (value.topScorers.some((row) => !isRecord(row) || typeof row.playerId !== "string"
    || typeof row.playerName !== "string" || typeof row.clubId !== "string" || typeof row.clubName !== "string"
    || !Number.isInteger(row.goals) || !Number.isInteger(row.assists))) return false;
  return true;
}
export class SupabaseCompetitionReadRepository implements CompetitionReadPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async listOpen(userId: string): Promise<Array<Record<string, unknown>>> {
    let result: unknown;
    try { result = await this.client.rpc("list_open_competitions_http", { p_user_id: userId }); }
    catch (error) { rethrowRpcError(error); }
    if (!validCompetitionList(result)) throw new Error("SUPABASE_COMPETITION_LIST_INVALID_RESPONSE");
    return result.map((row) => ({ ...row, rules: validateMatchRules(row.rules ?? defaultMatchRules(row.format as "LEAGUE" | "CUP")) }));
  }
  async get(userId: string, competitionId: string): Promise<Record<string, unknown>> {
    let result: unknown;
    try { result = await this.client.rpc("get_competition_http", { p_user_id: userId, p_competition_id: competitionId }); }
    catch (error) { rethrowRpcError(error); }
    if (!validCompetitionDetail(result)) throw new Error("SUPABASE_COMPETITION_DETAIL_INVALID_RESPONSE");
    const competition = result.competition as Record<string, unknown>;
    const matches = result.matches as Array<Record<string, unknown>>;
    return {
      ...result,
      competition: { ...competition, rules: validateMatchRules(competition.rules ?? defaultMatchRules(competition.format as "LEAGUE" | "CUP")) },
      matches: matches.map((match) => ({ ...match, rules: validateMatchRules(match.rules ?? defaultMatchRules(match.type as "FRIENDLY" | "LEAGUE" | "CUP")) })),
    };
  }
}
