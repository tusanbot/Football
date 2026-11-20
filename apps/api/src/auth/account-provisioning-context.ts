import { AsyncLocalStorage } from "node:async_hooks";
import type { GeneratedPlayer } from "@football/domain";

export interface TelegramAccountProvisioningCommand {
  telegramId: string;
  username: string | null;
  displayName: string;
  firstName: string;
  starterPlayers: GeneratedPlayer[];
}
export interface ProvisionedTelegramAccount {
  id: string;
  telegramId: string;
  displayName: string;
  club: { id: string; name: string; level: number; reputation: number } | null;
  wallets: { asset: "CASH" | "GOLD" | "HONOR"; balance: string }[];
}
export interface TelegramAccountProvisioningPort {
  provision(input: TelegramAccountProvisioningCommand): Promise<ProvisionedTelegramAccount>;
}
const scope = new AsyncLocalStorage<TelegramAccountProvisioningPort>();
export function withTelegramAccountProvisioningPort<T>(port: TelegramAccountProvisioningPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getTelegramAccountProvisioningPort(): TelegramAccountProvisioningPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("TELEGRAM_ACCOUNT_PROVISIONING_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
