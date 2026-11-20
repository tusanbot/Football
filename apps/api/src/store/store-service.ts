import { getStoreItem, STORE_CATALOG } from "./catalog.js";
import { getStorePurchasePort } from "./store-purchase-context.js";
import { getStoreItemUsePort } from "./store-item-use-context.js";
import { getStoreSnapshotPort } from "./store-snapshot-context.js";
import { getOpenMarketListings } from "../players/market-service.js";
import { getSpecialPackOffers } from "../players/special-acquisition-service.js";

export class StoreError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "StoreError";
  }
}

const validKey = /^[A-Za-z0-9:_-]{8,80}$/;

export async function getStoreSnapshot(userId: string) {
  const snapshotPort = getStoreSnapshotPort();
  if (!snapshotPort) throw new StoreError("SUPABASE_STORE_SNAPSHOT_UNAVAILABLE");
  const [snapshot, listings] = await Promise.all([snapshotPort.get(userId), getOpenMarketListings()]);
  return {
    items: STORE_CATALOG.map(({ effect: _effect, ...item }) => item),
    wallets: snapshot.wallets,
    inventory: snapshot.inventory,
    playerListings: listings,
    specialPlayers: snapshot.specialPlayers,
    packOffers: getSpecialPackOffers(),
  };
}

export async function purchaseStoreItem(userId: string, itemKey: string, quantity: number, idempotencyKey: string) {
  if (!validKey.test(idempotencyKey)) throw new StoreError("INVALID_IDEMPOTENCY_KEY");
  const item = getStoreItem(itemKey);
  if (!item) throw new StoreError("STORE_ITEM_NOT_FOUND");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > item.maxPerPurchase) throw new StoreError("INVALID_QUANTITY");
  const purchasePort = getStorePurchasePort();
  if (!purchasePort) throw new StoreError("SUPABASE_STORE_PURCHASE_UNAVAILABLE");
  try {
    return await purchasePort.purchase({ userId, itemKey, asset: item.asset, unitPrice: item.price, quantity, idempotencyKey });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (code) throw new StoreError(code);
    throw error;
  }
}

export async function useStoreItem(userId: string, itemKey: string, playerId: string, idempotencyKey: string) {
  if (!validKey.test(idempotencyKey)) throw new StoreError("INVALID_IDEMPOTENCY_KEY");
  const item = getStoreItem(itemKey);
  if (!item) throw new StoreError("STORE_ITEM_NOT_FOUND");
  const usePort = getStoreItemUsePort();
  if (!usePort) throw new StoreError("SUPABASE_STORE_ITEM_USE_UNAVAILABLE");
  try {
    return await usePort.use({ userId, itemKey, playerId, fitnessDelta: item.effect.fitness ?? 0, moraleDelta: item.effect.morale ?? 0, idempotencyKey });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (code) throw new StoreError(code);
    throw error;
  }
}
