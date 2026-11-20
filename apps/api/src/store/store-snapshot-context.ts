import { AsyncLocalStorage } from "node:async_hooks";

export interface StoreSnapshot {
  wallets: Array<{ asset: string; balance: string }>;
  inventory: Array<{ itemKey: string; quantity: number; updatedAt: string }>;
  specialPlayers: Array<{ id: string; fullName: string; nationality: string; positions: string[]; rarity: string; overall: number; potential: number }>;
}

export interface StoreSnapshotPort { get(userId: string): Promise<StoreSnapshot>; }
const scope = new AsyncLocalStorage<StoreSnapshotPort>();
export function withStoreSnapshotPort<T>(port: StoreSnapshotPort, operation: () => T): T { return scope.run(port, operation); }
export function getStoreSnapshotPort(): StoreSnapshotPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("STORE_SNAPSHOT_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
