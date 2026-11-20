import assert from "node:assert/strict";
import test from "node:test";
import { getStoreSnapshot, purchaseStoreItem, StoreError, useStoreItem } from "../src/store/store-service.js";

async function expectUnavailable(operation: Promise<unknown>, expected: string) {
  await assert.rejects(operation, (error: unknown) => error instanceof StoreError && error.code === expected);
}

test("store snapshot never falls back to Prisma", async () => {
  await expectUnavailable(getStoreSnapshot("user-1"), "SUPABASE_STORE_SNAPSHOT_UNAVAILABLE");
});

test("store purchase never falls back to Prisma", async () => {
  await expectUnavailable(purchaseStoreItem("user-1", "fitness_boost", 1, "store-test-key-0001"), "SUPABASE_STORE_PURCHASE_UNAVAILABLE");
});

test("store item use never falls back to Prisma", async () => {
  await expectUnavailable(useStoreItem("user-1", "fitness_boost", "player-1", "store-test-key-0002"), "SUPABASE_STORE_ITEM_USE_UNAVAILABLE");
});
