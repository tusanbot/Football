import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminCatalogActionsRepository } from "../src/repositories/admin-catalog-actions.js";
function repository(response:unknown){const calls:Array<{name:string;args:Record<string,unknown>}>=[];const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return response;}} as never;return{repo:new SupabaseAdminCatalogActionsRepository(client),calls};}
test("catalog toggle calls the atomic RPC with namespaced idempotency",async()=>{
 const {repo,calls}=repository({ok:true,targetType:"item",targetId:"item-1",replay:false});
 assert.deepEqual(await repo.execute({action:"toggle-item",targetId:"item-1",active:false,actorTelegramId:"910000001",idempotencyKey:"catalog-toggle-001"}),{ok:true,targetType:"item",targetId:"item-1",replay:false});
 assert.deepEqual(calls,[{name:"admin_catalog_toggle_http",args:{p_action:"toggle-item",p_target_id:"item-1",p_active:false,p_actor_telegram_id:"910000001",p_idempotency_key:"admin-catalog:catalog-toggle-001"}}]);
});
test("catalog toggle rejects invalid input and malformed RPC responses",async()=>{
 const invalid=repository({});
 await assert.rejects(invalid.repo.execute({action:"toggle-item",targetId:"item-1",active:"false" as unknown as boolean,actorTelegramId:"910000001",idempotencyKey:"catalog-toggle-002"}),/INVALID_ADMIN_CATALOG_ACTION/);
 const malformed=repository({ok:true,targetType:"item"});
 await assert.rejects(malformed.repo.execute({action:"toggle-gift-code",targetId:"gift-1",active:true,actorTelegramId:"910000001",idempotencyKey:"catalog-toggle-003"}),/SUPABASE_ADMIN_CATALOG_INVALID_RESPONSE/);
});

test("catalog create and edit use the Supabase management RPC",async()=>{
 const {repo,calls}=repository({ok:true,targetType:"gift-code",targetId:"gift-created",replay:false});
 const created=await repo.execute({action:"create-gift-code",actorTelegramId:"910000001",idempotencyKey:"catalog-gift-cf-001",code:"WELCOME",rewardType:"WALLET",cashAmount:"1000",goldAmount:"5",maxRedemptions:20,perUserLimit:2});
 assert.deepEqual(created,{ok:true,targetType:"gift-code",targetId:"gift-created",replay:false});
 assert.equal(calls[0]?.name,"admin_catalog_manage_http");
 assert.equal(calls[0]?.args.p_action,"create-gift-code");
 assert.equal(calls[0]?.args.p_code,"WELCOME");
});
