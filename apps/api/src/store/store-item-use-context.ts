import { AsyncLocalStorage } from "node:async_hooks";

export interface StoreItemUseCommand {
  userId: string;
  itemKey: string;
  playerId: string;
  fitnessDelta: number;
  moraleDelta: number;
  idempotencyKey: string;
}

export interface StoreItemUseResult {
  itemKey: string;
  playerId: string;
  inventory: number;
  player?: { fitness: number; morale: number };
  replayed: boolean;
}

export interface StoreItemUsePort {
  use(input: StoreItemUseCommand): Promise<StoreItemUseResult>;
}

const storeItemUseScope = new AsyncLocalStorage<StoreItemUsePort>();

export function withStoreItemUsePort<T>(port: StoreItemUsePort, operation: () => T): T {
  return storeItemUseScope.run(port, operation);
}

export function getStoreItemUsePort(): StoreItemUsePort | undefined {
  return storeItemUseScope.getStore();
}
