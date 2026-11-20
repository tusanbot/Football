import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminPyramidLeagueActionsRepository } from "../src/repositories/admin-pyramid-league-actions.js";
function repository(response: unknown) {
 const calls: Array<{name:string;args:Record<string,unknown>}>=[];
 const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return response;}} as never;
 return {repo:new SupabaseAdminPyramidLeagueActionsRepository(client),calls};
}
test("pyramid league actions reuse the existing atomic RPC",async()=>{
 const {repo,calls}=repository({ok:true,targetType:"league",targetId:"league-1",replay:false});
 assert.deepEqual(await repo.execute({action:"league-status",targetId:"league-1",actorTelegramId:"910000001",idempotencyKey:"stable-pyramid-001",status:"CANCELLED"}),{ok:true,targetType:"league",targetId:"league-1",replay:false});
 assert.deepEqual(calls,[{name:"admin_pyramid_league_action_http",args:{p_action:"league-status",p_target_id:"league-1",p_actor_telegram_id:"910000001",p_idempotency_key:"admin-pyramid:stable-pyramid-001",p_reason:null,p_status:"CANCELLED",p_hours:null,p_award_name:null,p_award_type:null}}]);
});
test("pyramid league actions validate fields and RPC response",async()=>{
 const invalid=repository({});
 await assert.rejects(invalid.repo.execute({action:"extend-promotion-deadline",targetId:"x",actorTelegramId:"bad",idempotencyKey:"short",hours:100}),/INVALID_ADMIN_ACTION/);
 const malformed=repository({ok:true,targetId:"x"});
 await assert.rejects(malformed.repo.execute({action:"withdraw-application",targetId:"x",actorTelegramId:"910000002",idempotencyKey:"stable-pyramid-002"}),/SUPABASE_ADMIN_PYRAMID_ACTION_INVALID_RESPONSE/);
});