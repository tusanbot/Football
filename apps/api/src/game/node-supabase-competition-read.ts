import type { CompetitionReadPort } from "./competition-read-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../node-supabase-http.js";

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
    || !Array.isArray(value.standings) || !Array.isArray(value.matches)
    || !Array.isArray(value.nextRoundMatches) || !Array.isArray(value.topScorers)
    || (value.nextRound !== null && !Number.isInteger(value.nextRound))) return false;
  return true;
}
export class SupabaseCompetitionReadRepository implements CompetitionReadPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async listOpen(userId: string): Promise<Array<Record<string, unknown>>> {
    let result: unknown;
    try { result = await this.client.rpc("list_open_competitions_http", { p_user_id: userId }); }
    catch (error) { rethrowRpcError(error); }
    if (!validCompetitionList(result)) throw new Error("SUPABASE_COMPETITION_LIST_INVALID_RESPONSE");
    return result;
  }
  async get(userId: string, competitionId: string): Promise<Record<string, unknown>> {
    let result: unknown;
    try { result = await this.client.rpc("get_competition_http", { p_user_id: userId, p_competition_id: competitionId }); }
    catch (error) { rethrowRpcError(error); }
    if (!validCompetitionDetail(result)) throw new Error("SUPABASE_COMPETITION_DETAIL_INVALID_RESPONSE");
    return result;
  }
}
