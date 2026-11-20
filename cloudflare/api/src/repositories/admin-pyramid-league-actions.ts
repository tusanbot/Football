import type { AdminPyramidLeagueActionsPort, AdminPyramidLeagueActionInput } from "../../../../apps/api/src/node-supabase-admin-pyramid-league-actions.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseAdminPyramidLeagueActionsRepository implements AdminPyramidLeagueActionsPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async execute(input: AdminPyramidLeagueActionInput) {
    if (!["league-status", "withdraw-application", "extend-promotion-deadline", "update-award"].includes(input.action)
      || !input.targetId || input.targetId.length > 128 || !/^[0-9]{1,20}$/.test(input.actorTelegramId)
      || !/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotencyKey)
      || (input.status !== undefined && input.status !== "CANCELLED")
      || (input.hours !== undefined && (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > 72))
      || (input.awardName !== undefined && input.awardName.length > 80)
      || (input.awardType !== undefined && input.awardType.length > 40)
      || (input.reason !== undefined && input.reason.length > 500)) throw new Error("INVALID_ADMIN_ACTION");
    const result = await this.client.rpc<Record<string, unknown>>("admin_pyramid_league_action_http", {
      p_action: input.action, p_target_id: input.targetId, p_actor_telegram_id: input.actorTelegramId,
      p_idempotency_key: "admin-pyramid:" + input.idempotencyKey, p_reason: input.reason ?? null,
      p_status: input.status ?? null, p_hours: input.hours ?? null,
      p_award_name: input.awardName ?? null, p_award_type: input.awardType ?? null,
    });
    if (!result || result.ok !== true || typeof result.targetType !== "string" || typeof result.targetId !== "string" || typeof result.replay !== "boolean") {
      throw new Error("SUPABASE_ADMIN_PYRAMID_ACTION_INVALID_RESPONSE");
    }
    return result as unknown as Awaited<ReturnType<AdminPyramidLeagueActionsPort["execute"]>>;
  }
}
