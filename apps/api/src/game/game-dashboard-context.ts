import { AsyncLocalStorage } from "node:async_hooks";

export interface GameDashboardSnapshot {
  user: { id: string; telegramId: string; username: string | null; displayName: string; createdAt: string };
  club: null | { id: string; name: string; level: number; reputation: number; createdAt: string; activeCompetition: null | { id: string; name: string } };
  wallets: Array<{ asset: string; balance: string; version: number }>;
}
export interface GameDashboardPort { getDashboard(userId: string): Promise<GameDashboardSnapshot>; }
const scope = new AsyncLocalStorage<GameDashboardPort>();
export function withGameDashboardPort<T>(port: GameDashboardPort, operation: () => Promise<T>): Promise<T> { return scope.run(port, operation); }
export function getGameDashboardPort(): GameDashboardPort | undefined { return scope.getStore(); }
