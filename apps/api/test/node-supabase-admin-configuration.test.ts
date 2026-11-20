import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { NodeSupabaseAdminConfigurationRepository } from "../src/node-supabase-admin-configuration.js";

test("admin configuration list uses protected HTTP RPC and validates shape",async()=>{
 let path="";
 const client=new SupabaseHttpClient({
  url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",
  fetchImpl:async(input)=>{path=new URL(String(input)).pathname;return new Response(JSON.stringify({roles:[],settings:[]}),{status:200,headers:{"content-type":"application/json"}});},
 });
 const repository=new NodeSupabaseAdminConfigurationRepository(client);
 assert.deepEqual(await repository.list(),{roles:[],settings:[]});
 assert.equal(path,"/rest/v1/rpc/get_admin_configuration_http");
});

test("admin configuration mutation sends actor and idempotency key to atomic RPC",async()=>{
 let path="";let body:Record<string,unknown>={};
 const client=new SupabaseHttpClient({
  url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",
  fetchImpl:async(input,init)=>{path=new URL(String(input)).pathname;body=JSON.parse(String(init?.body)) as Record<string,unknown>;return new Response(JSON.stringify({ok:true,targetType:"admin-role",targetId:"123456",recordId:"record-1",replay:false}),{status:200,headers:{"content-type":"application/json"}});},
 });
 const repository=new NodeSupabaseAdminConfigurationRepository(client);
 const result=await repository.execute({action:"set-admin-role",actorTelegramId:"987654",idempotencyKey:"stable-admin-key-001",adminTelegramId:"123456",adminRole:"moderator"});
 assert.equal(path,"/rest/v1/rpc/admin_configuration_action_http");
 assert.deepEqual(body,{p_action:"set-admin-role",p_actor_telegram_id:"987654",p_idempotency_key:"admin-config:stable-admin-key-001",p_target_telegram_id:"123456",p_role:"moderator",p_setting_key:null,p_setting_value:null,p_setting_description:null});
 assert.equal(result.replay,false);
});

test("admin configuration repository rejects malformed RPC responses and invalid actor IDs",async()=>{
 const client=new SupabaseHttpClient({
  url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",
  fetchImpl:async()=>new Response(JSON.stringify({ok:true,targetId:"123456"}),{status:200,headers:{"content-type":"application/json"}}),
 });
 const repository=new NodeSupabaseAdminConfigurationRepository(client);
 await assert.rejects(()=>repository.execute({action:"revoke-admin-role",actorTelegramId:"bad",idempotencyKey:"stable-admin-key-002",adminTelegramId:"123456"}),/INVALID_TELEGRAM_ID/);
 await assert.rejects(()=>repository.execute({action:"revoke-admin-role",actorTelegramId:"987654",idempotencyKey:"stable-admin-key-002",adminTelegramId:"123456"}),/SUPABASE_ADMIN_CONFIGURATION_INVALID_RESPONSE/);
});
