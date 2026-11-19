import type { AuthenticatedTelegramUser, TelegramUserLookupPort } from "./telegram-user-lookup-context.js";

/** Server-only HTTPS/PostgREST adapter for Telegram identity lookup and activity touch. */
export class NodeSupabaseTelegramUserLookupRepository implements TelegramUserLookupPort {
  private readonly baseUrl: string;
  constructor(url: string, private readonly serviceRoleKey: string, private readonly timeoutMs = 10_000) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\\.supabase\\.co$/i.test(parsed.hostname)
      || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new TypeError("SUPABASE_URL must be a direct HTTPS Supabase project origin");
    }
    if (!serviceRoleKey || serviceRoleKey.trim().length < 20) throw new TypeError("SUPABASE_SERVICE_ROLE_KEY is required");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new RangeError("Invalid Supabase HTTP timeout");
    this.baseUrl = parsed.origin;
  }
  async loadActiveUser(telegramId: string, now = new Date()): Promise<AuthenticatedTelegramUser | null> {
    if (!/^\\d{1,20}$/.test(telegramId)) return null;
    let response: Response;
    try {
      response = await fetch(this.baseUrl + "/rest/v1/rpc/resolve_telegram_user", {
        method: "POST", redirect: "error",
        headers: { apikey: this.serviceRoleKey, authorization: "Bearer " + this.serviceRoleKey, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ p_telegram_id: telegramId, p_now: now.toISOString() }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) { throw new Error("Supabase Telegram user lookup failed", { cause: error }); }
    const text = await response.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : null; } catch { throw new Error("Supabase Telegram user lookup returned invalid JSON"); }
    if (!response.ok) throw new Error("Supabase Telegram user lookup was rejected (" + response.status + ")");
    if (payload === null) return null;
    const value = Array.isArray(payload) ? payload[0] : payload;
    if (!value || typeof value !== "object") throw new Error("SUPABASE_TELEGRAM_USER_LOOKUP_INVALID_RESPONSE");
    const user = value as Record<string, unknown>;
    if (typeof user.id !== "string" || user.telegramId !== telegramId
      || typeof user.createdAt !== "string"
      || (user.username !== null && typeof user.username !== "string")
      || (user.displayName !== null && typeof user.displayName !== "string")) {
      throw new Error("SUPABASE_TELEGRAM_USER_LOOKUP_INVALID_RESPONSE");
    }
    return { id: user.id, telegramId, username: user.username as string | null, displayName: user.displayName as string, createdAt: user.createdAt };
  }
}
