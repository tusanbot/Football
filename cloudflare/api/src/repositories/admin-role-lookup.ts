import type { AdminRoleLookupPort } from "../../../../apps/api/src/admin-role-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseAdminRoleLookupRepository implements AdminRoleLookupPort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async getAssignment(telegramId: string) {
    if (!/^[0-9]{1,20}$/.test(telegramId)) throw new Error("INVALID_TELEGRAM_ID");
    const result = await this.client.rpc<{ role: string; active: boolean } | null>(
      "get_event_tournament_admin_role_http",
      { p_telegram_id: telegramId },
    );
    if (result === null) return null;
    if (!result || typeof result.role !== "string" || typeof result.active !== "boolean") {
      throw new Error("SUPABASE_ADMIN_ROLE_INVALID_RESPONSE");
    }
    return { role: result.role, active: result.active };
  }
}
