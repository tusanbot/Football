import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseAdminEntityUpdateRepository } from "../src/node-supabase-admin-entity-update.js";
function repository(response:unknown){const calls:Array<{name:string;args:Record<string,unknown>}>=[];const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return response;}} as never;return{repo:new NodeSupabaseAdminEntityUpdateRepository(client),calls};}
test("Node admin entity adapter sends update payload and audit reason to HTTP RPC",async()=>{
 const {repo,calls}=repository({ok:true,targetType:"player",targetId:"player-1",replay:false});
 const result=await repo.execute({action:"player-update",targetId:"player-1",actorTelegramId:"910000001",idempotencyKey:"admin-player-update-01",payload:{firstName:"Updated",overall:88},reason:"Correction"});
 assert.deepEqual(result,{ok:true,targetType:"player",targetId:"player-1",replay:false});
 assert.deepEqual(calls,[{name:"admin_entity_update_http",args:{p_action:"player-update",p_target_id:"player-1",p_actor_telegram_id:"910000001",p_idempotency_key:"admin-player-update-01",p_payload:{firstName:"Updated",overall:88},p_reason:"Correction"}}]);
});
test("Node admin entity adapter rejects invalid input and malformed RPC response",async()=>{
 const invalid=repository({});
 await assert.rejects(invalid.repo.execute({action:"club-update",targetId:"club-1",actorTelegramId:"bad",idempotencyKey:"short",payload:{level:2}}),/INVALID_ADMIN_ENTITY_ACTION/);
 const malformed=repository({ok:true,targetType:"club"});
 await assert.rejects(malformed.repo.execute({action:"club-update",targetId:"club-1",actorTelegramId:"910000001",idempotencyKey:"admin-club-update-01",payload:{level:2}}),/SUPABASE_ADMIN_ENTITY_INVALID_RESPONSE/);
});
