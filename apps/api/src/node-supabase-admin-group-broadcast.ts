import type {AdminGroupBroadcastDelivery,AdminGroupBroadcastPort} from "./admin-group-broadcast-routes.js";
import {SupabaseHttpClient} from "./node-supabase-http.js";
function rowArray(value:unknown,label:string):Record<string,unknown>[]{
 if(!Array.isArray(value))throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_"+label);
 return value.map(v=>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_ROW");return v as Record<string,unknown>;});
}
export class NodeSupabaseAdminGroupBroadcastRepository implements AdminGroupBroadcastPort{
 constructor(private readonly client:SupabaseHttpClient){}
 async claim(limit:number):Promise<AdminGroupBroadcastDelivery[]>{
  return rowArray(await this.client.rpc<unknown>("claim_due_admin_group_broadcasts_http",{p_limit:limit,p_lease_seconds:60}),"CLAIM").map(row=>{
   if(typeof row.id!=="string"||typeof row.telegram_group_id!=="string"||typeof row.message!=="string"||typeof row.claim_token!=="string"||!Number.isInteger(row.attempt))
    throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_CLAIM_ROW");
   return {id:row.id,telegramGroupId:row.telegram_group_id,message:row.message,claimToken:row.claim_token,attempt:row.attempt as number};
  });
 }
 async complete(id:string,claimToken:string):Promise<boolean>{
  const result=await this.client.rpc<unknown>("complete_admin_group_broadcast_delivery_http",{p_id:id,p_claim_token:claimToken});
  if(typeof result!=="boolean")throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_COMPLETION");return result;
 }
 async fail(id:string,claimToken:string,error:string):Promise<{rescheduled:boolean;attempts:number}|null>{
  const rows=rowArray(await this.client.rpc<unknown>("fail_admin_group_broadcast_delivery_http",{p_id:id,p_claim_token:claimToken,p_error:error}),"FAIL");
  if(rows.length===0)return null;if(rows.length!==1||typeof rows[0]!.rescheduled!=="boolean"||!Number.isInteger(rows[0]!.attempts))
   throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_FAIL");
  return {rescheduled:rows[0]!.rescheduled as boolean,attempts:rows[0]!.attempts as number};
 }
}
