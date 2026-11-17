import test from "node:test";
import assert from "node:assert/strict";
import { getStoreItem, STORE_CATALOG } from "../src/store/catalog.js";

test("store catalog exposes Cash, Gold and Honor consumables", () => {
  assert.equal(STORE_CATALOG.length, 4);
  assert.deepEqual(new Set(STORE_CATALOG.map((item) => item.asset)), new Set(["CASH", "GOLD", "HONOR"]));
  assert.equal(getStoreItem("honor_elite_recovery")?.asset, "HONOR");
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
