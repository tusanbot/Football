import { SupabaseHttpClient } from "./node-supabase-http.js";
export interface AdminConfigurationRole {id:string;telegramId:string;role:string;active:boolean;createdByTelegramId:string;updatedByTelegramId:string;createdAt:string;updatedAt:string;}
export interface AdminConfigurationSetting {id:string;key:string;value:unknown;description:string|null;updatedByTelegramId:string;createdAt:string;updatedAt:string;}
export interface AdminConfigurationSnapshot {roles:AdminConfigurationRole[];settings:AdminConfigurationSetting[];}
export interface AdminConfigurationActionInput {
 action:"set-admin-role"|"revoke-admin-role"|"set-game-setting";actorTelegramId:string;idempotencyKey:string;
 adminTelegramId?:string;adminRole?:"football"|"economy"|"moderator";settingKey?:string;settingValue?:unknown;settingDescription?:string;
}
export interface AdminConfigurationPort {list():Promise<AdminConfigurationSnapshot>;execute(input:AdminConfigurationActionInput):Promise<{ok:true;targetType:string;targetId:string;recordId?:string;replay:boolean}>;}
export class NodeSupabaseAdminConfigurationRepository implements AdminConfigurationPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async list():Promise<AdminConfigurationSnapshot>{
  const result=await this.client.rpc<Record<string,unknown>>("get_admin_configuration_http",{});
  if(!result||!Array.isArray(result.roles)||!Array.isArray(result.settings))throw new Error("SUPABASE_ADMIN_CONFIGURATION_INVALID_RESPONSE");
  return result as unknown as AdminConfigurationSnapshot;
 }
 async execute(input:AdminConfigurationActionInput){
  if(!/^[0-9]{1,20}$/.test(input.actorTelegramId))throw new Error("INVALID_TELEGRAM_ID");
  const result=await this.client.rpc<Record<string,unknown>>("admin_configuration_action_http",{
   p_action:input.action,p_actor_telegram_id:input.actorTelegramId,p_idempotency_key:"admin-config:"+input.idempotencyKey,
   p_target_telegram_id:input.adminTelegramId??null,p_role:input.adminRole??null,
   p_setting_key:input.settingKey??null,p_setting_value:input.settingValue??null,p_setting_description:input.settingDescription??null,
  });
  if(!result||result.ok!==true||typeof result.targetType!=="string"||typeof result.targetId!=="string"||typeof result.replay!=="boolean")
   throw new Error("SUPABASE_ADMIN_CONFIGURATION_INVALID_RESPONSE");
  return result as unknown as {ok:true;targetType:string;targetId:string;recordId?:string;replay:boolean};
 }
}
