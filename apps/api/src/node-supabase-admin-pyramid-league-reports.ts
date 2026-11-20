import { SupabaseHttpClient } from "./node-supabase-http.js";
export interface AdminPyramidLeagueReportFilters { season?:number; tier?:number; q?:string; limit:number; }
export interface AdminPyramidLeagueReportsPort { getReports(filters:AdminPyramidLeagueReportFilters):Promise<Record<string,unknown>>; }
export class NodeSupabaseAdminPyramidLeagueReportsRepository implements AdminPyramidLeagueReportsPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async getReports(filters:AdminPyramidLeagueReportFilters){
  const result=await this.client.rpc<Record<string,unknown>>("get_admin_pyramid_league_reports_http",{
   p_season:filters.season??null,p_tier:filters.tier??null,p_query:filters.q??null,p_audit_limit:filters.limit,
  });
  if(!result||!result.totals||typeof result.totals!=="object"||!Array.isArray(result.seasons)
   ||!Array.isArray(result.clubRankings)||!Array.isArray(result.movements)||!Array.isArray(result.leagueHistory)
   ||!Array.isArray(result.auditLogs)||!result.applicationCounts||typeof result.applicationCounts!=="object"){
   throw new Error("SUPABASE_ADMIN_PYRAMID_LEAGUE_REPORTS_INVALID_RESPONSE");
  }
  return result;
 }
}
