import type { GiftCodeRedemptionCommand, GiftCodeRedemptionPort, GiftCodeRedemptionResult } from "./gift-code-redemption-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../node-supabase-http.js";

interface GiftCodeRpcRow {
  cash: string;
  gold: string;
  group_points: string;
  replayed: boolean;
}

const GIFT_CODE_ERROR_CODES = new Set([
  "GIFT_CODE_UNAVAILABLE",
  "GIFT_CODE_GROUP_REQUIRED",
  "GIFT_CODE_GROUP_UNAVAILABLE",
  "GIFT_CODE_GROUP_MEMBERSHIP_REQUIRED",
  "GIFT_CODE_USER_LIMIT",
  "GIFT_CODE_EXHAUSTED",
  "IDEMPOTENCY_CONFLICT",
  "CONCURRENT_MODIFICATION",
]);

export class SupabaseGiftCodeRedemptionRepository implements GiftCodeRedemptionPort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async consumeRateLimit(input: { telegramUserId: string; limit: number }): Promise<boolean> {
    const rows = await this.client.rpc<boolean[]>("consume_gift_code_rate_limit", {
      p_telegram_user_id: input.telegramUserId, p_limit: input.limit,
    });
    return Array.isArray(rows) && rows[0] === true;
  }

  async getRewardType(code: string): Promise<string | null> {
    const rows = await this.client.rpc<string[]>("get_gift_code_reward_type", { p_code: code });
    return Array.isArray(rows) && typeof rows[0] === "string" ? rows[0] : null;
  }

  async redeem(input: GiftCodeRedemptionCommand): Promise<GiftCodeRedemptionResult> {
    let rows: GiftCodeRpcRow[];
    try {
      rows = await this.client.rpc<GiftCodeRpcRow[]>("redeem_gift_code", {
        p_user_id: input.userId,
        p_code: input.code,
        p_idempotency_key: input.idempotencyKey,
        p_telegram_group_id: input.telegramGroupId ?? null,
      });
    } catch (error) {
      const message = error instanceof SupabaseHttpError ? error.message : error instanceof Error ? error.message : "";
      const code = message.toLowerCase().includes("duplicate key") || message.toLowerCase().includes("unique constraint")
        ? "IDEMPOTENCY_CONFLICT"
        : [...GIFT_CODE_ERROR_CODES].find((candidate) => message.includes(candidate));
      if (code) throw new Error(code);
      throw error;
    }
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || typeof row.cash !== "string" || !/^-?\d+$/.test(row.cash)
      || typeof row.gold !== "string" || !/^-?\d+$/.test(row.gold)
      || typeof row.group_points !== "string" || !/^-?\d+$/.test(row.group_points)
      || typeof row.replayed !== "boolean") {
      throw new Error("SUPABASE_GIFT_CODE_INVALID_RESPONSE");
    }
    return {
      ok: true,
      reward: { cash: row.cash, gold: row.gold, groupPoints: row.group_points },
      replayed: row.replayed,
    };
  }
}
