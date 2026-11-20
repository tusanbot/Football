import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { NodeSupabaseAdminPyramidLeagueReportsRepository } from "../src/node-supabase-admin-pyramid-league-reports.js";

test("admin pyramid league reports sends bounded filters to the reports RPC",async()=>{
 let requestPath="";
 let body:Record<string,unknown>={};
 const payload={totals:{leagues:1,completedLeagues:1,seasons:1,clubs:1,promotions:0,relegations:0},
  seasons:[],clubRankings:[],movements:[],leagueHistory:[],auditLogs:[],applicationCounts:{QUEUED:0}};
 const client=new SupabaseHttpClient({
  url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",
  fetchImpl:async(input,init)=>{
   requestPath=new URL(String(input)).pathname;
   body=JSON.parse(String(init?.body)) as Record<string,unknown>;
   return new Response(JSON.stringify(payload),{status:200,headers:{"content-type":"application/json"}});
  },
 });
 const repository=new NodeSupabaseAdminPyramidLeagueReportsRepository(client);
 const result=await repository.getReports({season:2027,tier:3,q:"North",limit:45});
 assert.equal(requestPath,"/rest/v1/rpc/get_admin_pyramid_league_reports_http");
 assert.deepEqual(body,{p_season:2027,p_tier:3,p_query:"North",p_audit_limit:45});
 assert.deepEqual(result.totals,payload.totals);
});

test("admin pyramid league reports rejects malformed RPC response",async()=>{
 const client=new SupabaseHttpClient({
  url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",
  fetchImpl:async()=>new Response(JSON.stringify({totals:{},seasons:[]}),{status:200,headers:{"content-type":"application/json"}}),
 });
 const repository=new NodeSupabaseAdminPyramidLeagueReportsRepository(client);
 await assert.rejects(()=>repository.getReports({limit:100}),/SUPABASE_ADMIN_PYRAMID_LEAGUE_REPORTS_INVALID_RESPONSE/);
});
