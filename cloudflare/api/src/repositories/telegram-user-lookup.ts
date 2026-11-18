import type { AuthenticatedTelegramUser, TelegramUserLookupPort } from "../../../../apps/api/src/auth/telegram-user-lookup-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseTelegramUserLookupRepository implements TelegramUserLookupPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async loadActiveUser(telegramId: string, now = new Date()): Promise<AuthenticatedTelegramUser | null> {
    const result = await this.client.rpc<AuthenticatedTelegramUser | null>("resolve_telegram_user", {
      p_telegram_id: telegramId, p_now: now.toISOString(),
    });
    if (result === null) return null;
    if (!result || typeof result !== "object" || typeof result.id !== "string" || result.telegramId !== telegramId) {
      throw new Error("SUPABASE_TELEGRAM_USER_LOOKUP_INVALID_RESPONSE");
    }
    return result;
  }
}
