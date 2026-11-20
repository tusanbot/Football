import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminEntityUpdateRepository } from "../src/repositories/admin-entity-update.js";
function repository(response:unknown){const calls:Array<{name:string;args:Record<string,unknown>}>=[];const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return response;}} as never;return{repo:new SupabaseAdminEntityUpdateRepository(client),calls};}
test("Cloudflare admin entity adapter invokes the shared HTTP RPC",async()=>{
 const {repo,calls}=repository({ok:true,targetType:"match",targetId:"match-1",replay:false});
 const result=await repo.execute({action:"match-update",targetId:"match-1",actorTelegramId:"910000001",idempotencyKey:"admin-match-update-01",payload:{homeScore:2,awayScore:1},reason:"Schedule correction"});
 assert.deepEqual(result,{ok:true,targetType:"match",targetId:"match-1",replay:false});
 assert.deepEqual(calls,[{name:"admin_entity_update_http",args:{p_action:"match-update",p_target_id:"match-1",p_actor_telegram_id:"910000001",p_idempotency_key:"admin-match-update-01",p_payload:{homeScore:2,awayScore:1},p_reason:"Schedule correction"}}]);
});
test("Cloudflare admin entity adapter rejects malformed input and response",async()=>{
 const invalid=repository({});
 await assert.rejects(invalid.repo.execute({action:"season-status",targetId:"season-1",actorTelegramId:"910000001",idempotencyKey:"short",payload:{status:"ACTIVE"}}),/INVALID_ADMIN_ENTITY_ACTION/);
 const malformed=repository({ok:true,targetType:"alliance"});
 await assert.rejects(malformed.repo.execute({action:"alliance-status",targetId:"alliance-1",actorTelegramId:"910000001",idempotencyKey:"admin-alliance-status-01",payload:{status:"ACTIVE"}}),/SUPABASE_ADMIN_ENTITY_INVALID_RESPONSE/);
});
