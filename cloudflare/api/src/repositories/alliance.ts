import type { AlliancePort } from "../../../../apps/api/src/groups/alliance-context.js";
import { AllianceServiceError } from "../../../../apps/api/src/groups/alliance-service.js";
import { SupabaseHttpError } from "../supabase-http.js";
import { SupabaseHttpClient } from "../supabase-http.js";
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("SUPABASE_ALLIANCE_INVALID_RESPONSE");return value as Record<string,unknown>;}
function unwrap(value:unknown):unknown{const v=object(value);if(typeof v.error==="string")throw new AllianceServiceError(v.error);return v;}
export class SupabaseAllianceRepository implements AlliancePort{
 constructor(private readonly client:SupabaseHttpClient){}
 private async call(name:string,args:Record<string,unknown>):Promise<unknown>{try{return unwrap(await this.client.rpc(name,args));}catch(error){if(error instanceof SupabaseHttpError && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message))throw new AllianceServiceError(error.message);throw error;}}
 async createAlliance(i:Parameters<AlliancePort["createAlliance"]>[0]){return await this.call("create_alliance_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_name:i.name,p_description:i.description??"",p_idempotency_key:i.idempotencyKey});}
 async inviteAllianceGroup(i:Parameters<AlliancePort["inviteAllianceGroup"]>[0]){return await this.call("invite_alliance_group_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_target_telegram_group_id:i.targetTelegramGroupId});}
 async respondAllianceInvitation(i:Parameters<AlliancePort["respondAllianceInvitation"]>[0]){return await this.call("respond_alliance_invitation_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_invitation_id:i.invitationId,p_accept:i.accept});}
 async contributeAllianceTreasury(i:Parameters<AlliancePort["contributeAllianceTreasury"]>[0]){return await this.call("contribute_alliance_treasury_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_amount:i.amount,p_idempotency_key:i.idempotencyKey});}
 async getAllianceWorkspace(i:Parameters<AlliancePort["getAllianceWorkspace"]>[0]){return await this.call("get_alliance_workspace_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_is_reviewer:i.isReviewer});}
 async startAllianceSeason(i:Parameters<AlliancePort["startAllianceSeason"]>[0]){return await this.call("start_alliance_season_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_duration_days:i.durationDays??null});}
 async closeAllianceSeason(i:Parameters<AlliancePort["closeAllianceSeason"]>[0]){return await this.call("close_alliance_season_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId});}
 async reviewAllianceSeason(i:Parameters<AlliancePort["reviewAllianceSeason"]>[0]){return await this.call("review_alliance_season_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_season_id:i.seasonId,p_decision:i.decision,p_is_reviewer:i.isReviewer});}
}
