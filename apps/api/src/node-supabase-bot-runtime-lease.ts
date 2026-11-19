import type { BotRuntimeLeaseAction, BotRuntimeLeasePort, BotRuntimeLeaseResult } from "./bot-runtime-lease-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";

export class SupabaseBotRuntimeLeaseRepository implements BotRuntimeLeasePort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async execute(instanceId: string, action: BotRuntimeLeaseAction, now: string): Promise<BotRuntimeLeaseResult> {
    const result = await this.client.rpc<BotRuntimeLeaseResult>("manage_bot_runtime_lease_http", {
      p_instance_id: instanceId,
      p_action: action,
      p_now: now,
      p_lease_seconds: 60,
    });
    if (!result || typeof result !== "object"
      || typeof result.acquired !== "boolean" || typeof result.released !== "boolean"
      || (result.leaseExpiresAt !== null && typeof result.leaseExpiresAt !== "string")) {
      throw new Error("SUPABASE_BOT_RUNTIME_LEASE_INVALID_RESPONSE");
    }
    return result;
  }
}
