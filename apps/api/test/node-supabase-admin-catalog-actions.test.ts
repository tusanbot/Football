import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseAdminCatalogActionsRepository } from "../src/node-supabase-admin-catalog-actions.js";
function repository(response:unknown){const calls:Array<{name:string;args:Record<string,unknown>}>=[];const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return response;}} as never;return{repo:new NodeSupabaseAdminCatalogActionsRepository(client),calls};}
test("Node admin catalog adapter calls the HTTP RPC with stable idempotency",async()=>{
 const {repo,calls}=repository({ok:true,targetType:"gift-code",targetId:"gift-1",replay:false});
 assert.deepEqual(await repo.execute({action:"toggle-gift-code",targetId:"gift-1",active:false,actorTelegramId:"910000001",idempotencyKey:"catalog-toggle-node-01"}),{ok:true,targetType:"gift-code",targetId:"gift-1",replay:false});
 assert.deepEqual(calls,[{name:"admin_catalog_toggle_http",args:{p_action:"toggle-gift-code",p_target_id:"gift-1",p_active:false,p_actor_telegram_id:"910000001",p_idempotency_key:"admin-catalog:catalog-toggle-node-01"}}]);
});
test("Node admin catalog adapter rejects invalid inputs and malformed responses",async()=>{
 const invalid=repository({});
 await assert.rejects(invalid.repo.execute({action:"toggle-item",targetId:"item-1",active:true,actorTelegramId:"bad",idempotencyKey:"short"}),/INVALID_ADMIN_CATALOG_ACTION/);
 const malformed=repository({ok:true,targetType:"item"});
 await assert.rejects(malformed.repo.execute({action:"toggle-item",targetId:"item-1",active:true,actorTelegramId:"910000001",idempotencyKey:"catalog-toggle-node-02"}),/SUPABASE_ADMIN_CATALOG_INVALID_RESPONSE/);
});
