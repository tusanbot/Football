import test from "node:test";
import assert from "node:assert/strict";
import { getStoreItem, STORE_CATALOG } from "./catalog.js";

test("store catalog exposes valid Cash and Gold consumables", () => {
  assert.equal(STORE_CATALOG.length, 3);
  assert.deepEqual(new Set(STORE_CATALOG.map((item) => item.asset)), new Set(["CASH", "GOLD"]));
  for (const item of STORE_CATALOG) {
    assert.ok(item.key.length > 0);
    assert.ok(BigInt(item.price) > 0n);
    assert.ok(item.maxPerPurchase > 0);
  }
});

test("store item lookup is exact and unknown items are rejected", () => {
  assert.equal(getStoreItem("recovery_kit")?.effect.fitness, 35);
  assert.equal(getStoreItem("morale_boost")?.effect.morale, 15);
  assert.equal(getStoreItem("not-a-real-item"), undefined);
});
