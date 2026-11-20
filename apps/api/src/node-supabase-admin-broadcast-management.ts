import { SupabaseHttpClient } from "./node-supabase-http.js";
export interface AdminBroadcastRetryPort {
 retry(kind:"groups"|"users",targetId:string,actorTelegramId:string,idempotencyKey:string):Promise<{retried:number;replayed:boolean}>;
}
export class NodeSupabaseAdminBroadcastManagementRepository implements AdminBroadcastRetryPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async retry(kind:"groups"|"users",targetId:string,actorTelegramId:string,idempotencyKey:string){
  if(!targetId||targetId.length>128||!/^[0-9]{1,20}$/.test(actorTelegramId)||!/^[A-Za-z0-9:_-]{12,128}$/.test(idempotencyKey))throw new Error("INVALID_BROADCAST_RETRY");
  const result=await this.client.rpc<Record<string,unknown>>("admin_broadcast_retry_http",{
   p_kind:kind,p_target_id:targetId,p_actor_telegram_id:actorTelegramId,
   p_idempotency_key:(kind==="groups"?"admin-group-broadcast-retry:":"admin-user-broadcast-retry:")+idempotencyKey,
  });
  if(!result||result.ok!==true||!Number.isInteger(result.retried)||Number(result.retried)<0||typeof result.replayed!=="boolean")throw new Error("SUPABASE_ADMIN_BROADCAST_RETRY_INVALID_RESPONSE");
  return {retried:Number(result.retried),replayed:result.replayed};
 }
}
