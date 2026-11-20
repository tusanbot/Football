import { SupabaseHttpClient } from "./node-supabase-http.js";
export type AdminFinancialAdjustmentAction = "adjust-wallet"|"adjust-group-points";
export interface AdminFinancialAdjustmentInput {
 action:AdminFinancialAdjustmentAction;targetId:string;amount:string;actorTelegramId:string;
 idempotencyKey:string;reason:string;asset?:"CASH"|"GOLD"|"HONOR";
}
export interface AdminFinancialAdjustmentPort {
 execute(input:AdminFinancialAdjustmentInput):Promise<{ok:true;targetType:string;targetId:string;replay:boolean;balance?:string;points?:string;ledgerId?:string}>;
}
export class NodeSupabaseAdminFinancialAdjustmentsRepository implements AdminFinancialAdjustmentPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async execute(input:AdminFinancialAdjustmentInput){
  if(!input.targetId||input.targetId.length>128||!/^-[0-9]{1,15}$|^[0-9]{1,15}$/.test(input.amount)||input.amount==="0"||
   !/^[0-9]{1,20}$/.test(input.actorTelegramId)||!/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotencyKey)||
   !input.reason.trim()||input.reason.length>500||
   (input.action==="adjust-wallet"&&!input.asset)||(input.action==="adjust-group-points"&&input.asset))throw new Error("INVALID_ADMIN_FINANCIAL_ADJUSTMENT");
  const result=await this.client.rpc<Record<string,unknown>>("admin_financial_adjustment_http",{
   p_action:input.action,p_target_id:input.targetId,p_amount:input.amount,p_asset:input.asset??null,
   p_actor_telegram_id:input.actorTelegramId,p_idempotency_key:input.idempotencyKey,p_reason:input.reason,
  });
  if(!result||result.ok!==true||typeof result.targetType!=="string"||typeof result.targetId!=="string"||
   typeof result.replay!=="boolean"||(result.balance!==undefined&&typeof result.balance!=="string")||
   (result.points!==undefined&&typeof result.points!=="string")||(result.ledgerId!==undefined&&typeof result.ledgerId!=="string"))throw new Error("SUPABASE_ADMIN_FINANCIAL_ADJUSTMENT_INVALID_RESPONSE");
  return result as unknown as {ok:true;targetType:string;targetId:string;replay:boolean;balance?:string;points?:string;ledgerId?:string};
 }
}
