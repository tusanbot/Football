import { SupabaseHttpClient } from "./node-supabase-http.js";
export interface AdminPyramidLeagueActionInput {
 action:"league-status"|"withdraw-application"|"extend-promotion-deadline"|"update-award";
 targetId:string;actorTelegramId:string;idempotencyKey:string;reason?:string;status?:"CANCELLED";
 hours?:number;awardName?:string;awardType?:string;
}
export interface AdminPyramidLeagueActionResult {ok:true;targetType:string;targetId:string;replay:boolean;expiresAt?:string|null;}
export interface AdminPyramidLeagueActionsPort { execute(input:AdminPyramidLeagueActionInput):Promise<AdminPyramidLeagueActionResult>; }
export class NodeSupabaseAdminPyramidLeagueActionsRepository implements AdminPyramidLeagueActionsPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async execute(input:AdminPyramidLeagueActionInput){
  const result=await this.client.rpc<Record<string,unknown>>("admin_pyramid_league_action_http",{
   p_action:input.action,p_target_id:input.targetId,p_actor_telegram_id:input.actorTelegramId,
   p_idempotency_key:"admin-pyramid:"+input.idempotencyKey,p_reason:input.reason??null,
   p_status:input.status??null,p_hours:input.hours??null,p_award_name:input.awardName??null,p_award_type:input.awardType??null,
  });
  if(!result||result.ok!==true||typeof result.targetType!=="string"||typeof result.targetId!=="string"||typeof result.replay!=="boolean"){
   throw new Error("SUPABASE_ADMIN_PYRAMID_ACTION_INVALID_RESPONSE");
  }
  return result as unknown as AdminPyramidLeagueActionResult;
 }
}
