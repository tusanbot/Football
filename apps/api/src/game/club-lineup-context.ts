import { AsyncLocalStorage } from "node:async_hooks";
export type ClubLineupUpdate = {
  formation: "4-3-3" | "4-4-2" | "3-5-2" | "4-2-3-1";
  playerIds: string[];
  expectedVersion: number;
  tactics?: {
    mentality?: "DEFENSIVE" | "BALANCED" | "ATTACKING" | undefined;
    pressing?: "LOW_BLOCK" | "MID_BLOCK" | "HIGH_PRESS" | undefined;
    tempo?: "SLOW" | "NORMAL" | "FAST" | undefined;
    passingStyle?: "SHORT" | "MIXED" | "DIRECT" | undefined;
  } | undefined;
};
export interface ClubLineupPort {
  get(userId: string): Promise<unknown>;
  update(userId: string, input: ClubLineupUpdate): Promise<{ ok: boolean; lineupVersion?: number; error?: string; currentVersion?: number }>;
}
const scope = new AsyncLocalStorage<ClubLineupPort>();
export function withClubLineupPort<T>(port: ClubLineupPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getClubLineupPort(): ClubLineupPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("CLUB_LINEUP_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
