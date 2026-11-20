import { SupabaseHttpClient } from "./node-supabase-http.js";
export type AdminCatalogToggleAction = "toggle-item" | "toggle-gift-code";
export interface AdminCatalogActionInput { action: AdminCatalogToggleAction; targetId: string; active: boolean; actorTelegramId: string; idempotencyKey: string; }
export interface AdminCatalogActionPort { execute(input: AdminCatalogActionInput): Promise<{ ok: true; targetType: string; targetId: string; replay: boolean }>; }
export class NodeSupabaseAdminCatalogActionsRepository implements AdminCatalogActionPort {
 constructor(private readonly client: SupabaseHttpClient) {}
 async execute(input: AdminCatalogActionInput) {
  if (!["toggle-item","toggle-gift-code"].includes(input.action) || !input.targetId || input.targetId.length>128
   || typeof input.active!=="boolean" || !/^[0-9]{1,20}$/.test(input.actorTelegramId)
   || !/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotencyKey)) throw new Error("INVALID_ADMIN_CATALOG_ACTION");
  const result=await this.client.rpc<Record<string,unknown>>("admin_catalog_toggle_http",{
   p_action:input.action,p_target_id:input.targetId,p_active:input.active,p_actor_telegram_id:input.actorTelegramId,
   p_idempotency_key:"admin-catalog:"+input.idempotencyKey,
  });
  if(!result||result.ok!==true||typeof result.targetType!=="string"||typeof result.targetId!=="string"||typeof result.replay!=="boolean")
   throw new Error("SUPABASE_ADMIN_CATALOG_INVALID_RESPONSE");
  return result as unknown as Awaited<ReturnType<AdminCatalogActionPort["execute"]>>;
 }
}
