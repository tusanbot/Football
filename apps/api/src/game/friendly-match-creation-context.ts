import { AsyncLocalStorage } from "node:async_hooks";
import type { FootballMatch } from "@prisma/client";

export interface FriendlyMatchCreationPort {
  create(userId: string, opponentClubId: string, idempotencyKey: string, scheduledAt: Date): Promise<{ match: FootballMatch; replayed: boolean }>;
}
const scope = new AsyncLocalStorage<FriendlyMatchCreationPort>();
export function withFriendlyMatchCreationPort<T>(port: FriendlyMatchCreationPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getFriendlyMatchCreationPort(): FriendlyMatchCreationPort | undefined {
  return scope.getStore();
}
