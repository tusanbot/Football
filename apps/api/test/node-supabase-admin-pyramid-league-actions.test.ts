import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { NodeSupabaseAdminPyramidLeagueActionsRepository } from "../src/node-supabase-admin-pyramid-league-actions.js";

test("admin pyramid action sends actor, idempotency and action fields to atomic RPC",async()=>{
 let requestPath="";
 let body:Record<string,unknown>={};
 const client=new SupabaseHttpClient({
  url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",
  fetchImpl:async(input,init)=>{
   requestPath=new URL(String(input)).pathname;
   body=JSON.parse(String(init?.body)) as Record<string,unknown>;
   return new Response(JSON.stringify({ok:true,targetType:"league-application",targetId:"app-1",replay:false}),{
    status:200,headers:{"content-type":"application/json"},
   });
  },
 });
 const repository=new NodeSupabaseAdminPyramidLeagueActionsRepository(client);
 const result=await repository.execute({
  action:"withdraw-application",targetId:"app-1",actorTelegramId:"123456",idempotencyKey:"stable-key-12345",reason:"policy violation",
 });
 assert.equal(requestPath,"/rest/v1/rpc/admin_pyramid_league_action_http");
 assert.deepEqual(body,{
  p_action:"withdraw-application",p_target_id:"app-1",p_actor_telegram_id:"123456",
  p_idempotency_key:"admin-pyramid:stable-key-12345",p_reason:"policy violation",
  p_status:null,p_hours:null,p_award_name:null,p_award_type:null,
 });
 assert.equal(result.replay,false);
});

test("admin pyramid action rejects malformed RPC response",async()=>{
 const client=new SupabaseHttpClient({
  url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",
  fetchImpl:async()=>new Response(JSON.stringify({ok:true,targetId:"app-1"}),{status:200,headers:{"content-type":"application/json"}}),
 });
 const repository=new NodeSupabaseAdminPyramidLeagueActionsRepository(client);
 await assert.rejects(()=>repository.execute({
  action:"withdraw-application",targetId:"app-1",actorTelegramId:"123456",idempotencyKey:"stable-key-12345",
 }),/SUPABASE_ADMIN_PYRAMID_ACTION_INVALID_RESPONSE/);
});
