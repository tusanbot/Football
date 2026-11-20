import { SupabaseHttpClient } from "./node-supabase-http.js";
export type AdminCatalogToggleAction = "toggle-item" | "toggle-gift-code";
export type AdminCatalogManageAction = "create-item" | "item-update" | "create-gift-code";
export type AdminCatalogAction = AdminCatalogToggleAction | AdminCatalogManageAction;
export interface AdminCatalogActionInput {
 action: AdminCatalogAction; targetId?: string; active?: boolean; actorTelegramId: string; idempotencyKey: string;
 itemSlug?: string; itemName?: string; itemDescription?: string; itemCost?: string; itemScope?: "PERSONAL"|"GROUP";
 code?: string; rewardType?: "WALLET"|"GROUP_POINTS"; cashAmount?: string; goldAmount?: string; groupPoints?: string;
 maxRedemptions?: number; perUserLimit?: number; expiresAt?: string;
}
export interface AdminCatalogActionPort { execute(input: AdminCatalogActionInput): Promise<{ ok: true; targetType: string; targetId: string; replay: boolean }>; }
function validate(input:AdminCatalogActionInput){
 if(!["toggle-item","toggle-gift-code","create-item","item-update","create-gift-code"].includes(input.action)
  || !/^[0-9]{1,20}$/.test(input.actorTelegramId)||!/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotencyKey)) throw new Error("INVALID_ADMIN_CATALOG_ACTION");
 if(input.action==="toggle-item"||input.action==="toggle-gift-code"){
  if(!input.targetId||input.targetId.length>128||typeof input.active!=="boolean")throw new Error("INVALID_ADMIN_CATALOG_ACTION");
 }else if(input.action==="create-item"){
  if(!input.itemSlug||!input.itemName||!input.itemDescription||input.itemCost===undefined||!input.itemScope)throw new Error("INVALID_ITEM");
 }else if(input.action==="item-update"){
  if(!input.targetId||input.targetId.length>128||(!input.itemName&&!input.itemDescription&&input.itemCost===undefined))throw new Error("INVALID_ITEM");
 }else if(!input.code||!input.maxRedemptions)throw new Error("INVALID_GIFT_CODE");
}
export class NodeSupabaseAdminCatalogActionsRepository implements AdminCatalogActionPort {
 constructor(private readonly client: SupabaseHttpClient) {}
 async execute(input: AdminCatalogActionInput) {
  validate(input);
  const key="admin-catalog:"+input.idempotencyKey;
  const result=input.action==="toggle-item"||input.action==="toggle-gift-code"
   ? await this.client.rpc<Record<string,unknown>>("admin_catalog_toggle_http",{
      p_action:input.action,p_target_id:input.targetId,p_active:input.active,p_actor_telegram_id:input.actorTelegramId,p_idempotency_key:key,
     })
   : await this.client.rpc<Record<string,unknown>>("admin_catalog_manage_http",{
      p_action:input.action,p_target_id:input.targetId??null,p_actor_telegram_id:input.actorTelegramId,p_idempotency_key:key,
      p_item_slug:input.itemSlug??null,p_item_name:input.itemName??null,p_item_description:input.itemDescription??null,
      p_item_cost:input.itemCost??null,p_item_scope:input.itemScope??null,p_code:input.code??null,
      p_reward_type:input.rewardType??null,p_cash_amount:input.cashAmount??"0",p_gold_amount:input.goldAmount??"0",
      p_group_points:input.groupPoints??"0",p_max_redemptions:input.maxRedemptions??null,p_per_user_limit:input.perUserLimit??1,
      p_expires_at:input.expiresAt??null,
     });
  if(!result||result.ok!==true||typeof result.targetType!=="string"||typeof result.targetId!=="string"||typeof result.replay!=="boolean")
   throw new Error("SUPABASE_ADMIN_CATALOG_INVALID_RESPONSE");
  return result as unknown as Awaited<ReturnType<AdminCatalogActionPort["execute"]>>;
 }
}
