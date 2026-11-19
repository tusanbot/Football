import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthenticatedTelegramUser {
  id: string; telegramId: string; username: string | null; displayName: string; createdAt: string;
}
export interface TelegramUserLookupPort { loadActiveUser(telegramId: string, now?: Date): Promise<AuthenticatedTelegramUser | null>; }
const scope = new AsyncLocalStorage<TelegramUserLookupPort>();
export function withTelegramUserLookupPort<T>(port: TelegramUserLookupPort, operation: () => Promise<T>): Promise<T> { return scope.run(port, operation); }
export function getTelegramUserLookupPort(): TelegramUserLookupPort | undefined { return scope.getStore(); }
