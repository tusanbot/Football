import type { AdminGroupBroadcastDelivery, AdminGroupBroadcastPort } from "../../../../apps/api/src/admin-group-broadcast-routes.js";
import { SupabaseHttpClient } from "../supabase-http.js";
function rows(value: unknown, label: string): Record<string, unknown>[] {
 if (!Array.isArray(value)) throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_" + label);
 return value.map((item) => { if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_ROW"); return item as Record<string, unknown>; });
}
export class SupabaseAdminGroupBroadcastRepository implements AdminGroupBroadcastPort {
 constructor(private readonly client: SupabaseHttpClient) {}
 async claim(limit: number): Promise<AdminGroupBroadcastDelivery[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_ADMIN_GROUP_BROADCAST_LIMIT");
  return rows(await this.client.rpc<unknown>("claim_due_admin_group_broadcasts_http", { p_limit: limit, p_lease_seconds: 60 }), "CLAIM").map((row) => {
   if (typeof row.id !== "string" || typeof row.telegram_group_id !== "string" || typeof row.message !== "string" || typeof row.claim_token !== "string" || !Number.isInteger(row.attempt)) throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_CLAIM_ROW");
   return { id: row.id, telegramGroupId: row.telegram_group_id, message: row.message, claimToken: row.claim_token, attempt: row.attempt as number };
  });
 }
 async complete(id: string, claimToken: string): Promise<boolean> {
  if (!id || id.length > 128 || !/^[0-9a-f-]{36}$/i.test(claimToken)) throw new Error("INVALID_ADMIN_GROUP_BROADCAST_COMPLETION");
  const result = await this.client.rpc<unknown>("complete_admin_group_broadcast_delivery_http", { p_id: id, p_claim_token: claimToken });
  if (typeof result !== "boolean") throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_COMPLETION");
  return result;
 }
 async fail(id: string, claimToken: string, error: string): Promise<{ rescheduled: boolean; attempts: number } | null> {
  if (!id || id.length > 128 || !/^[0-9a-f-]{36}$/i.test(claimToken) || !error.trim() || error.length > 500) throw new Error("INVALID_ADMIN_GROUP_BROADCAST_FAILURE");
  const result = rows(await this.client.rpc<unknown>("fail_admin_group_broadcast_delivery_http", { p_id: id, p_claim_token: claimToken, p_error: error }), "FAIL");
  if (!result.length) return null;
  if (result.length !== 1 || typeof result[0]!.rescheduled !== "boolean" || !Number.isInteger(result[0]!.attempts)) throw new Error("SUPABASE_ADMIN_GROUP_BROADCAST_INVALID_FAIL");
  return { rescheduled: result[0]!.rescheduled as boolean, attempts: result[0]!.attempts as number };
 }
}
