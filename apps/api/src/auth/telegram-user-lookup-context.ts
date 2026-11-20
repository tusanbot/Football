import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthenticatedTelegramUser {
  id: string; telegramId: string; username: string | null; displayName: string; createdAt: string;
}
export interface TelegramUserLookupPort { loadActiveUser(telegramId: string, now?: Date): Promise<AuthenticatedTelegramUser | null>; }
const scope = new AsyncLocalStorage<TelegramUserLookupPort>();
export function withTelegramUserLookupPort<T>(port: TelegramUserLookupPort, operation: () => Promise<T>): Promise<T> { return scope.run(port, operation); }
export function getTelegramUserLookupPort(): TelegramUserLookupPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("TELEGRAM_USER_LOOKUP_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
