import { AsyncLocalStorage } from "node:async_hooks";

export interface MatchOpponent {
  id: string;
  name: string;
  level: number;
  reputation: number;
  ownerTelegramId: string;
  ownerUsername: string | null;
  lastActiveAt: string;
}
export interface MatchOpponentPort {
  list(userId: string, search?: string): Promise<MatchOpponent[]>;
}
const scope = new AsyncLocalStorage<MatchOpponentPort>();
export function withMatchOpponentPort<T>(port: MatchOpponentPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getMatchOpponentPort(): MatchOpponentPort | undefined {
  const port = scope.getStore();
  if (!port && process.env.NODE_ENV === "production") throw new Error("MATCH_OPPONENT_SUPABASE_REPOSITORY_REQUIRED");
  return port;
}
