import { SupabaseHttpClient } from "./node-supabase-http.js";
export type AdminModerationAction = "suspend-user"|"restore-user"|"suspend-group"|"restore-group"|"cancel-challenge"|"league-status"|"competition-status";
export interface AdminModerationActionInput { action:AdminModerationAction;targetId:string;actorTelegramId:string;idempotencyKey:string;reason?:string; }
export interface AdminModerationActionPort { execute(input:AdminModerationActionInput):Promise<{ok:true;targetType:string;targetId:string;replay:boolean}>; }
export class NodeSupabaseAdminModerationActionsRepository implements AdminModerationActionPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async execute(input:AdminModerationActionInput){
  if(!/^[0-9]{1,20}$/.test(input.actorTelegramId)||!input.targetId||input.targetId.length>128||!/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotencyKey))throw new Error("INVALID_ADMIN_ACTION");
  const result=await this.client.rpc<Record<string,unknown>>("admin_moderation_action_http",{
   p_action:input.action,p_target_id:input.targetId,p_actor_telegram_id:input.actorTelegramId,
   p_idempotency_key:"admin-moderation:"+input.idempotencyKey,p_reason:input.reason??null,
  });
  if(!result||result.ok!==true||typeof result.targetType!=="string"||typeof result.targetId!=="string"||typeof result.replay!=="boolean")throw new Error("SUPABASE_ADMIN_MODERATION_INVALID_RESPONSE");
  return result as unknown as {ok:true;targetType:string;targetId:string;replay:boolean};
 }
}
