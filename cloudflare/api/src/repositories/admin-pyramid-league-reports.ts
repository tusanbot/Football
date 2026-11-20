import type { AdminPyramidLeagueReportsPort, AdminPyramidLeagueReportFilters } from "../../../../apps/api/src/node-supabase-admin-pyramid-league-reports.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseAdminPyramidLeagueReportsRepository implements AdminPyramidLeagueReportsPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async getReports(filters: AdminPyramidLeagueReportFilters) {
    if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100
      || (filters.season !== undefined && (!Number.isInteger(filters.season) || filters.season < 2020 || filters.season > 2200))
      || (filters.tier !== undefined && (!Number.isInteger(filters.tier) || filters.tier < 1 || filters.tier > 7))) throw new Error("INVALID_ADMIN_PYRAMID_LEAGUE_REPORT_FILTERS");
    const result = await this.client.rpc<Record<string, unknown>>("get_admin_pyramid_league_reports_http", {
      p_season: filters.season ?? null, p_tier: filters.tier ?? null, p_query: filters.q ?? null, p_audit_limit: filters.limit,
    });
    if (!result || !result.totals || typeof result.totals !== "object" || Array.isArray(result.totals)
      || !Array.isArray(result.seasons) || !Array.isArray(result.clubRankings) || !Array.isArray(result.movements)
      || !Array.isArray(result.leagueHistory) || !Array.isArray(result.auditLogs)
      || !result.applicationCounts || typeof result.applicationCounts !== "object" || Array.isArray(result.applicationCounts)) {
      throw new Error("SUPABASE_ADMIN_PYRAMID_LEAGUE_REPORTS_INVALID_RESPONSE");
    }
    return result;
  }
}
