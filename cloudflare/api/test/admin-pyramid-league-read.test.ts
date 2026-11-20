import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminPyramidLeagueReadRepository } from "../src/repositories/admin-pyramid-league-read.js";
function repository(response: unknown) {
 const calls: Array<{name:string;args:Record<string,unknown>}>=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return response;}} as never;
 return {repo:new SupabaseAdminPyramidLeagueReadRepository(client),calls};
}
test("pyramid league read uses existing RPC and forwards filters",async()=>{
 const result={leagues:[],queues:[],offers:[],applicationCounts:{}};
 const {repo,calls}=repository(result);
 assert.deepEqual(await repo.list({season:2026,tier:2,status:"ACTIVE",q:"alpha",limit:25}),result);
 assert.deepEqual(calls,[{name:"get_admin_pyramid_leagues_http",args:{p_season:2026,p_tier:2,p_status:"ACTIVE",p_query:"alpha",p_limit:25}}]);
});
test("pyramid league read rejects invalid filters and response",async()=>{
 const {repo}=repository({leagues:[]});
 await assert.rejects(repo.list({tier:8,limit:10}),/INVALID_ADMIN_PYRAMID_LEAGUE_FILTERS/);
 await assert.rejects(repo.list({limit:10}),/SUPABASE_ADMIN_PYRAMID_LEAGUES_INVALID_RESPONSE/);
});