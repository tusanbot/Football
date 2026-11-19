import { AsyncLocalStorage } from "node:async_hooks";

export interface StoreSnapshot {
  wallets: Array<{ asset: string; balance: string }>;
  inventory: Array<{ itemKey: string; quantity: number; updatedAt: string }>;
  specialPlayers: Array<{ id: string; fullName: string; nationality: string; positions: string[]; rarity: string; overall: number; potential: number }>;
}

export interface StoreSnapshotPort { get(userId: string): Promise<StoreSnapshot>; }
const scope = new AsyncLocalStorage<StoreSnapshotPort>();
export function withStoreSnapshotPort<T>(port: StoreSnapshotPort, operation: () => T): T { return scope.run(port, operation); }
export function getStoreSnapshotPort(): StoreSnapshotPort | undefined { return scope.getStore(); }
