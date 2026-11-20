import type { AdminFinancialAdjustmentInput, AdminFinancialAdjustmentPort } from "../../../../apps/api/src/node-supabase-admin-financial-adjustments.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseAdminFinancialAdjustmentsRepository implements AdminFinancialAdjustmentPort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async execute(input: AdminFinancialAdjustmentInput) {
    if ((input.action !== "adjust-wallet" && input.action !== "adjust-group-points")
      || typeof input.targetId !== "string" || !input.targetId || input.targetId.length > 128
      || typeof input.amount !== "string" || !/^-?[0-9]{1,15}$/.test(input.amount) || input.amount === "0"
      || !/^[0-9]{1,20}$/.test(input.actorTelegramId)
      || !/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotencyKey)
      || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500
      || (input.action === "adjust-wallet" && !["CASH", "GOLD", "HONOR"].includes(input.asset ?? ""))
      || (input.action === "adjust-group-points" && input.asset !== undefined)) {
      throw new Error("INVALID_ADMIN_FINANCIAL_ADJUSTMENT");
    }

    const result = await this.client.rpc<Record<string, unknown>>("admin_financial_adjustment_http", {
      p_action: input.action,
      p_target_id: input.targetId,
      p_amount: input.amount,
      p_asset: input.asset ?? null,
      p_actor_telegram_id: input.actorTelegramId,
      p_idempotency_key: input.idempotencyKey,
      p_reason: input.reason,
    });

    if (!result || result.ok !== true || typeof result.targetType !== "string"
      || typeof result.targetId !== "string" || typeof result.replay !== "boolean"
      || (result.balance !== undefined && typeof result.balance !== "string")
      || (result.points !== undefined && typeof result.points !== "string")
      || (result.ledgerId !== undefined && typeof result.ledgerId !== "string")) {
      throw new Error("SUPABASE_ADMIN_FINANCIAL_ADJUSTMENT_INVALID_RESPONSE");
    }
    return result as unknown as Awaited<ReturnType<AdminFinancialAdjustmentPort["execute"]>>;
  }
}
