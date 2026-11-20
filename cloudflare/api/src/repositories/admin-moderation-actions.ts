import type { AdminModerationActionPort, AdminModerationActionInput } from "../../../../apps/api/src/node-supabase-admin-moderation-actions.js";
import { SupabaseHttpClient } from "../supabase-http.js";

const actions = new Set(["suspend-user", "restore-user", "suspend-group", "restore-group", "cancel-challenge", "league-status", "competition-status"]);

export class SupabaseAdminModerationActionsRepository implements AdminModerationActionPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async execute(input: AdminModerationActionInput) {
    if (!actions.has(input.action) || !/^[0-9]{1,20}$/.test(input.actorTelegramId)
      || !input.targetId || input.targetId.length > 128
      || !/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotencyKey)
      || (input.reason !== undefined && input.reason.length > 500)) throw new Error("INVALID_ADMIN_ACTION");
    const result = await this.client.rpc<Record<string, unknown>>("admin_moderation_action_http", {
      p_action: input.action, p_target_id: input.targetId, p_actor_telegram_id: input.actorTelegramId,
      p_idempotency_key: "admin-moderation:" + input.idempotencyKey, p_reason: input.reason ?? null,
    });
    if (!result || result.ok !== true || typeof result.targetType !== "string" || typeof result.targetId !== "string" || typeof result.replay !== "boolean") {
      throw new Error("SUPABASE_ADMIN_MODERATION_INVALID_RESPONSE");
    }
    return result as unknown as Awaited<ReturnType<AdminModerationActionPort["execute"]>>;
  }
}
