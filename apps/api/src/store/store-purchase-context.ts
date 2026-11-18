import { AsyncLocalStorage } from "node:async_hooks";

export type StoreWalletAsset = "CASH" | "GOLD" | "HONOR";

export interface StorePurchaseCommand {
  userId: string;
  itemKey: string;
  asset: StoreWalletAsset;
  unitPrice: string;
  quantity: number;
  idempotencyKey: string;
}

export interface StorePurchaseResult {
  itemKey: string;
  quantity: number;
  balance: string;
  inventory: number;
  replayed: boolean;
}

export interface StorePurchasePort {
  purchase(input: StorePurchaseCommand): Promise<StorePurchaseResult>;
}

const storePurchaseScope = new AsyncLocalStorage<StorePurchasePort>();

export function withStorePurchasePort<T>(port: StorePurchasePort, operation: () => T): T {
  return storePurchaseScope.run(port, operation);
}

export function getStorePurchasePort(): StorePurchasePort | undefined {
  return storePurchaseScope.getStore();
}
