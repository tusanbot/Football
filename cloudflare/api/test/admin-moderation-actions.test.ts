import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminModerationActionsRepository } from "../src/repositories/admin-moderation-actions.js";
function repository(response: unknown) {
 const calls: Array<{name:string;args:Record<string,unknown>}>=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return response;}} as never;
 return {repo:new SupabaseAdminModerationActionsRepository(client),calls};
}
test("moderation actions call the existing atomic RPC with namespaced idempotency",async()=>{
 const {repo,calls}=repository({ok:true,targetType:"user",targetId:"u-1",replay:false});
 assert.deepEqual(await repo.execute({action:"suspend-user",targetId:"u-1",actorTelegramId:"910000001",idempotencyKey:"stable-moderation-001",reason:"policy"}),{ok:true,targetType:"user",targetId:"u-1",replay:false});
 assert.deepEqual(calls,[{name:"admin_moderation_action_http",args:{p_action:"suspend-user",p_target_id:"u-1",p_actor_telegram_id:"910000001",p_idempotency_key:"admin-moderation:stable-moderation-001",p_reason:"policy"}}]);
});
test("moderation actions reject invalid input and malformed RPC responses",async()=>{
 const invalid=repository({});
 await assert.rejects(invalid.repo.execute({action:"suspend-user",targetId:"u",actorTelegramId:"bad",idempotencyKey:"short"}),/INVALID_ADMIN_ACTION/);
 const malformed=repository({ok:true,targetType:"user"});
 await assert.rejects(malformed.repo.execute({action:"restore-user",targetId:"u",actorTelegramId:"910000001",idempotencyKey:"stable-moderation-002"}),/SUPABASE_ADMIN_MODERATION_INVALID_RESPONSE/);
});