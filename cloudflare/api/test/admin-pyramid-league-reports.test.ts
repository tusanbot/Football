import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminPyramidLeagueReportsRepository } from "../src/repositories/admin-pyramid-league-reports.js";
function repository(response: unknown) {
 const calls: Array<{name:string;args:Record<string,unknown>}>=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return response;}} as never;
 return {repo:new SupabaseAdminPyramidLeagueReportsRepository(client),calls};
}
test("pyramid league reports reuse existing report RPC",async()=>{
 const result={totals:{},seasons:[],clubRankings:[],movements:[],leagueHistory:[],auditLogs:[],applicationCounts:{}};
 const {repo,calls}=repository(result);
 assert.deepEqual(await repo.getReports({season:2026,tier:3,q:"alpha",limit:40}),result);
 assert.deepEqual(calls,[{name:"get_admin_pyramid_league_reports_http",args:{p_season:2026,p_tier:3,p_query:"alpha",p_audit_limit:40}}]);
});
test("pyramid league reports reject invalid filters and response",async()=>{
 const {repo}=repository({totals:{}});
 await assert.rejects(repo.getReports({tier:9,limit:10}),/INVALID_ADMIN_PYRAMID_LEAGUE_REPORT_FILTERS/);
 await assert.rejects(repo.getReports({limit:10}),/SUPABASE_ADMIN_PYRAMID_LEAGUE_REPORTS_INVALID_RESPONSE/);
});