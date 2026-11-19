import type { AlliancePort } from "../../../../apps/api/src/groups/alliance-context.js";
import { AllianceServiceError } from "../../../../apps/api/src/groups/alliance-service.js";
import { SupabaseHttpClient } from "../supabase-http.js";
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("SUPABASE_ALLIANCE_INVALID_RESPONSE");return value as Record<string,unknown>;}
function unwrap(value:unknown):unknown{const v=object(value);if(typeof v.error==="string")throw new AllianceServiceError(v.error);return v;}
export class SupabaseAllianceRepository implements AlliancePort{
 constructor(private readonly client:SupabaseHttpClient){}
 async createAlliance(i:Parameters<AlliancePort["createAlliance"]>[0]){return unwrap(await this.client.rpc("create_alliance_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_name:i.name,p_description:i.description??"",p_idempotency_key:i.idempotencyKey}));}
 async inviteAllianceGroup(i:Parameters<AlliancePort["inviteAllianceGroup"]>[0]){return unwrap(await this.client.rpc("invite_alliance_group_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_target_telegram_group_id:i.targetTelegramGroupId}));}
 async respondAllianceInvitation(i:Parameters<AlliancePort["respondAllianceInvitation"]>[0]){return unwrap(await this.client.rpc("respond_alliance_invitation_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_invitation_id:i.invitationId,p_accept:i.accept}));}
 async contributeAllianceTreasury(i:Parameters<AlliancePort["contributeAllianceTreasury"]>[0]){return unwrap(await this.client.rpc("contribute_alliance_treasury_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_amount:i.amount,p_idempotency_key:i.idempotencyKey}));}
}
