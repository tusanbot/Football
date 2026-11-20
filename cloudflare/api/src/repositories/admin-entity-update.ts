import type { AdminEntityUpdateInput, AdminEntityUpdatePort } from "../../../../apps/api/src/node-supabase-admin-entity-update.js";
import { SupabaseHttpClient } from "../supabase-http.js";
export class SupabaseAdminEntityUpdateRepository implements AdminEntityUpdatePort {
 constructor(private readonly client:SupabaseHttpClient){}
 async execute(input:AdminEntityUpdateInput){
  if(!["player-update","club-update","match-update","player-status","alliance-status","season-status"].includes(input.action)
   ||!input.targetId||input.targetId.length>128||!/^[0-9]{1,20}$/.test(input.actorTelegramId)
   ||!/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotencyKey)||!input.payload||typeof input.payload!=="object"||Array.isArray(input.payload)||Object.keys(input.payload).length===0)
   throw new Error("INVALID_ADMIN_ENTITY_ACTION");
  const result=await this.client.rpc<Record<string,unknown>>("admin_entity_update_http",{
   p_action:input.action,p_target_id:input.targetId,p_actor_telegram_id:input.actorTelegramId,
   p_idempotency_key:input.idempotencyKey,p_payload:input.payload,
  });
  if(!result||result.ok!==true||typeof result.targetType!=="string"||typeof result.targetId!=="string"||typeof result.replay!=="boolean")
   throw new Error("SUPABASE_ADMIN_ENTITY_INVALID_RESPONSE");
  return result as unknown as {ok:true;targetType:string;targetId:string;replay:boolean};
 }
}
