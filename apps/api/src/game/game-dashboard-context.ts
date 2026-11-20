import { AsyncLocalStorage } from "node:async_hooks";

export interface GameDashboardSnapshot {
  user: { id: string; telegramId: string; username: string | null; displayName: string; createdAt: string };
  club: null | { id: string; name: string; level: number; reputation: number; createdAt: string; activeCompetition: null | { id: string; name: string } };
  wallets: Array<{ asset: string; balance: string; version: number }>;
}
export interface GameDashboardPort { getDashboard(userId: string): Promise<GameDashboardSnapshot>; }
const scope = new AsyncLocalStorage<GameDashboardPort>();
export function withGameDashboardPort<T>(port: GameDashboardPort, operation: () => Promise<T>): Promise<T> { return scope.run(port, operation); }
export function getGameDashboardPort(): GameDashboardPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("GAME_DASHBOARD_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
