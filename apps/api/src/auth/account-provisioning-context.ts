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
  return scope.getStore();
}
