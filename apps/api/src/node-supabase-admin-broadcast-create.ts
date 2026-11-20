import { SupabaseHttpClient } from "./node-supabase-http.js";
export type AdminBroadcastCreateKind = "users" | "groups";
export interface AdminBroadcastCreatePort {
 create(kind: AdminBroadcastCreateKind, message: string, actorTelegramId: string, idempotencyKey: string): Promise<{ ok: true; kind: AdminBroadcastCreateKind; targetId: string; recipients: number; replay: boolean }>;
}
export class NodeSupabaseAdminBroadcastCreateRepository implements AdminBroadcastCreatePort {
 constructor(private readonly client: SupabaseHttpClient) {}
 async create(kind: AdminBroadcastCreateKind, message: string, actorTelegramId: string, idempotencyKey: string) {
  if (!["users","groups"].includes(kind) || typeof message !== "string" || message.trim().length < 2 || message.trim().length > 3000
   || !/^[0-9]{1,20}$/.test(actorTelegramId) || !/^[A-Za-z0-9:_-]{12,128}$/.test(idempotencyKey)) {
   throw new Error("INVALID_ADMIN_BROADCAST");
  }
  const result = await this.client.rpc<Record<string, unknown>>("admin_broadcast_create_http", {
   p_kind: kind, p_message: message.trim(), p_actor_telegram_id: actorTelegramId, p_idempotency_key: idempotencyKey,
  });
  if (!result || result.ok !== true || result.kind !== kind || typeof result.targetId !== "string"
   || !Number.isSafeInteger(result.recipients) || Number(result.recipients) < 1 || typeof result.replay !== "boolean") {
   throw new Error("SUPABASE_ADMIN_BROADCAST_CREATE_INVALID_RESPONSE");
  }
  return result as unknown as { ok: true; kind: AdminBroadcastCreateKind; targetId: string; recipients: number; replay: boolean };
 }
}
