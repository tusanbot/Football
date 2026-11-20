import type { TelegramMessageDeletionPort, TelegramMessageDeletionJob } from "./telegram-message-deletion-routes.js";
import { SupabaseHttpClient } from "./node-supabase-http.js";

function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("SUPABASE_TELEGRAM_DELETION_INVALID_" + label);
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("SUPABASE_TELEGRAM_DELETION_INVALID_ROW");
    return item as Record<string, unknown>;
  });
}
function one(value: unknown, label: string): Record<string, unknown> {
  const result = rows(value, label);
  if (result.length !== 1) throw new Error("SUPABASE_TELEGRAM_DELETION_INVALID_" + label);
  return result[0]!;
}
export class NodeSupabaseTelegramMessageDeletionRepository implements TelegramMessageDeletionPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async schedule(input: { telegramChatId: string; messageId: number; deleteAt: string }) {
    const row = one(await this.client.rpc<unknown>("schedule_telegram_message_deletion_http", {
      p_telegram_chat_id: input.telegramChatId, p_message_id: input.messageId, p_delete_at: input.deleteAt,
    }), "SCHEDULE_RESPONSE");
    if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.delete_at !== "string") {
      throw new Error("SUPABASE_TELEGRAM_DELETION_INVALID_SCHEDULE_ROW");
    }
    return { id: row.id, status: row.status, deleteAt: row.delete_at };
  }
  async claim(limit: number): Promise<TelegramMessageDeletionJob[]> {
    return rows(await this.client.rpc<unknown>("claim_due_telegram_message_deletions_http", { p_limit: limit }), "CLAIM_RESPONSE").map((row) => {
      if (typeof row.id !== "string" || typeof row.telegram_chat_id !== "string"
        || !Number.isInteger(row.message_id) || typeof row.claim_token !== "string") {
        throw new Error("SUPABASE_TELEGRAM_DELETION_INVALID_CLAIM_ROW");
      }
      return { id: row.id, telegramChatId: row.telegram_chat_id, messageId: row.message_id as number, claimToken: row.claim_token };
    });
  }
  async complete(id: string, claimToken: string): Promise<boolean> {
    const value = await this.client.rpc<unknown>("complete_telegram_message_deletion_http", { p_id: id, p_claim_token: claimToken });
    if (typeof value !== "boolean") throw new Error("SUPABASE_TELEGRAM_DELETION_INVALID_COMPLETION_RESPONSE");
    return value;
  }
  async fail(id: string, claimToken: string, error: string) {
    const row = one(await this.client.rpc<unknown>("fail_telegram_message_deletion_http", {
      p_id: id, p_claim_token: claimToken, p_error: error,
    }), "FAIL_RESPONSE");
    if (typeof row.rescheduled !== "boolean" || typeof row.failed !== "boolean" || !Number.isInteger(row.attempts)) {
      throw new Error("SUPABASE_TELEGRAM_DELETION_INVALID_FAIL_ROW");
    }
    return { rescheduled: row.rescheduled, failed: row.failed, attempts: row.attempts as number };
  }
}
