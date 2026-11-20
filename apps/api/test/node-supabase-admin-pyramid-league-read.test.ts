import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { NodeSupabaseAdminPyramidLeagueReadRepository } from "../src/node-supabase-admin-pyramid-league-read.js";

test("admin pyramid league read sends validated filters to its dedicated Supabase RPC", async () => {
 let requestPath="";
 let body:Record<string,unknown>={};
 const client=new SupabaseHttpClient({
  url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",
  fetchImpl:async(input,init)=>{
   requestPath=new URL(String(input)).pathname;
   body=JSON.parse(String(init?.body)) as Record<string,unknown>;
   return new Response(JSON.stringify({leagues:[],queues:[],offers:[],applicationCounts:{QUEUED:2}}),{
    status:200,headers:{"content-type":"application/json"},
   });
  },
 });
 const repository=new NodeSupabaseAdminPyramidLeagueReadRepository(client);
 const result=await repository.list({season:2027,tier:2,status:"ACTIVE",q:"North",limit:40});
 assert.equal(requestPath,"/rest/v1/rpc/get_admin_pyramid_leagues_http");
 assert.deepEqual(body,{p_season:2027,p_tier:2,p_status:"ACTIVE",p_query:"North",p_limit:40});
 assert.equal((result.applicationCounts as Record<string,number>).QUEUED,2);
});

test("admin pyramid league read rejects malformed RPC response",async()=>{
 const client=new SupabaseHttpClient({
  url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",
  fetchImpl:async()=>new Response(JSON.stringify({leagues:[]}),{status:200,headers:{"content-type":"application/json"}}),
 });
 const repository=new NodeSupabaseAdminPyramidLeagueReadRepository(client);
 await assert.rejects(()=>repository.list({limit:60}),/SUPABASE_ADMIN_PYRAMID_LEAGUES_INVALID_RESPONSE/);
});
