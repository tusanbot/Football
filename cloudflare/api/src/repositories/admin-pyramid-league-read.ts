import type { AdminPyramidLeagueReadPort, AdminPyramidLeagueFilters } from "../../../../apps/api/src/node-supabase-admin-pyramid-league-read.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseAdminPyramidLeagueReadRepository implements AdminPyramidLeagueReadPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async list(filters: AdminPyramidLeagueFilters) {
    if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100
      || (filters.season !== undefined && (!Number.isInteger(filters.season) || filters.season < 2020 || filters.season > 2200))
      || (filters.tier !== undefined && (!Number.isInteger(filters.tier) || filters.tier < 1 || filters.tier > 7))) throw new Error("INVALID_ADMIN_PYRAMID_LEAGUE_FILTERS");
    const result = await this.client.rpc<Record<string, unknown>>("get_admin_pyramid_leagues_http", {
      p_season: filters.season ?? null, p_tier: filters.tier ?? null, p_status: filters.status ?? null,
      p_query: filters.q ?? null, p_limit: filters.limit,
    });
    if (!result || !Array.isArray(result.leagues) || !Array.isArray(result.queues) || !Array.isArray(result.offers)
      || !result.applicationCounts || typeof result.applicationCounts !== "object" || Array.isArray(result.applicationCounts)) {
      throw new Error("SUPABASE_ADMIN_PYRAMID_LEAGUES_INVALID_RESPONSE");
    }
    return result;
  }
}
