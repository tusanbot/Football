import type { ActionRateLimitCommand, ActionRateLimitPort } from "../../../../apps/api/src/groups/action-rate-limit-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseActionRateLimitRepository implements ActionRateLimitPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async consume(input: ActionRateLimitCommand): Promise<boolean> {
    const result = await this.client.rpc<boolean>("consume_alliance_action_rate_limit_http", {
      p_key: input.key,
      p_window_start: input.windowStart,
      p_now: input.now,
      p_limit: input.limit,
    });
    if (typeof result !== "boolean") throw new Error("SUPABASE_ACTION_RATE_LIMIT_INVALID_RESPONSE");
    return result;
  }
}
