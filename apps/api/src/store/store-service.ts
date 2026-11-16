import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { getStoreItem, STORE_CATALOG } from "./catalog.js";

export class StoreError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "StoreError";
  }
}

const validKey = /^[A-Za-z0-9:_-]{8,80}$/;

export async function getStoreSnapshot(userId: string) {
  const [wallets, inventory] = await Promise.all([
    prisma.wallet.findMany({ where: { userId }, select: { asset: true, balance: true } }),
    prisma.storeInventoryItem.findMany({ where: { userId, quantity: { gt: 0 } }, orderBy: { updatedAt: "desc" }, select: { itemKey: true, quantity: true, updatedAt: true } }),
  ]);
  return {
    items: STORE_CATALOG.map(({ effect: _effect, ...item }) => item),
    wallets: wallets.map((wallet) => ({ asset: wallet.asset, balance: wallet.balance.toString() })),
    inventory,
  };
}

export async function purchaseStoreItem(userId: string, itemKey: string, quantity: number, idempotencyKey: string) {
  if (!validKey.test(idempotencyKey)) throw new StoreError("INVALID_IDEMPOTENCY_KEY");
  const item = getStoreItem(itemKey);
  if (!item) throw new StoreError("STORE_ITEM_NOT_FOUND");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > item.maxPerPurchase) throw new StoreError("INVALID_QUANTITY");
  const total = BigInt(item.price) * BigInt(quantity);
  const ledgerKey = "store-purchase:" + idempotencyKey;

  try {
    return await prisma.$transaction(async (tx) => {
      const previous = await tx.storePurchase.findUnique({ where: { idempotencyKey } });
      if (previous) {
        if (previous.userId !== userId || previous.itemKey !== itemKey || previous.asset !== item.asset || previous.quantity !== quantity) {
          throw new StoreError("IDEMPOTENCY_CONFLICT");
        }
        const wallet = await tx.wallet.findUnique({ where: { userId_asset: { userId, asset: item.asset } }, select: { balance: true } });
        const stock = await tx.storeInventoryItem.findUnique({ where: { userId_itemKey: { userId, itemKey } }, select: { quantity: true } });
        return { itemKey, quantity, balance: wallet?.balance.toString() ?? "0", inventory: stock?.quantity ?? 0, replayed: true };
      }

      const wallet = await tx.wallet.findUnique({
        where: { userId_asset: { userId, asset: item.asset } },
        select: { id: true, balance: true, version: true },
      });
      if (!wallet) throw new StoreError("WALLET_NOT_FOUND");
      if (wallet.balance < total) throw new StoreError("INSUFFICIENT_FUNDS");

      const changed = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
        data: { balance: { decrement: total }, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new StoreError("CONCURRENT_MODIFICATION");

      const purchase = await tx.storePurchase.create({
        data: { idempotencyKey, userId, itemKey, asset: item.asset, amount: total, quantity },
        select: { id: true },
      });
      await tx.ledgerTransaction.create({
        data: {
          idempotencyKey: ledgerKey,
          userId,
          asset: item.asset,
          direction: "DEBIT",
          amount: total,
          reason: "STORE_PURCHASE",
          referenceType: "STORE_PURCHASE",
          referenceId: purchase.id,
        },
      });
      const inventory = await tx.storeInventoryItem.upsert({
        where: { userId_itemKey: { userId, itemKey } },
        create: { userId, itemKey, quantity },
        update: { quantity: { increment: quantity } },
        select: { quantity: true },
      });
      return { itemKey, quantity, balance: (wallet.balance - total).toString(), inventory: inventory.quantity, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof StoreError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new StoreError("IDEMPOTENCY_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new StoreError("CONCURRENT_MODIFICATION");
    }
    throw error;
  }
}

export async function useStoreItem(userId: string, itemKey: string, playerId: string, idempotencyKey: string) {
  if (!validKey.test(idempotencyKey)) throw new StoreError("INVALID_IDEMPOTENCY_KEY");
  const item = getStoreItem(itemKey);
  if (!item) throw new StoreError("STORE_ITEM_NOT_FOUND");

  try {
    return await prisma.$transaction(async (tx) => {
      const prior = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: "store-use:" + idempotencyKey } });
      if (prior) {
        if (prior.userId !== userId || prior.reason !== "STORE_ITEM_USE" || prior.referenceId !== playerId || prior.referenceType !== itemKey) {
          throw new StoreError("IDEMPOTENCY_CONFLICT");
        }
        const current = await tx.storeInventoryItem.findUnique({ where: { userId_itemKey: { userId, itemKey } }, select: { quantity: true } });
        return { itemKey, playerId, inventory: current?.quantity ?? 0, replayed: true };
      }
      const club = await tx.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
      if (!club) throw new StoreError("CLUB_NOT_FOUND");
      const player = await tx.player.findFirst({
        where: { id: playerId, clubId: club.id, status: { in: ["ACTIVE", "INJURED"] } },
        select: { id: true, fitness: true, morale: true },
      });
      if (!player) throw new StoreError("PLAYER_NOT_FOUND");
      const inventory = await tx.storeInventoryItem.updateMany({
        where: { userId, itemKey, quantity: { gt: 0 } },
        data: { quantity: { decrement: 1 } },
      });
      if (inventory.count !== 1) throw new StoreError("ITEM_NOT_IN_INVENTORY");
      const updatedPlayer = await tx.player.update({
        where: { id: player.id },
        data: {
          ...(item.effect.fitness ? { fitness: Math.min(100, player.fitness + item.effect.fitness) } : {}),
          ...(item.effect.morale ? { morale: Math.min(100, player.morale + item.effect.morale) } : {}),
        },
        select: { fitness: true, morale: true },
      });
      await tx.ledgerTransaction.create({
        data: {
          idempotencyKey: "store-use:" + idempotencyKey,
          userId,
          asset: item.asset,
          direction: "DEBIT",
          amount: 1n,
          reason: "STORE_ITEM_USE",
          referenceType: itemKey,
          referenceId: playerId,
        },
      });
      const remaining = await tx.storeInventoryItem.findUnique({
        where: { userId_itemKey: { userId, itemKey } },
        select: { quantity: true },
      });
      return { itemKey, playerId, inventory: remaining?.quantity ?? 0, player: updatedPlayer, replayed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof StoreError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new StoreError("IDEMPOTENCY_CONFLICT");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new StoreError("CONCURRENT_MODIFICATION");
    throw error;
  }
}
