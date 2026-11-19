import assert from "node:assert/strict";
import test from "node:test";
import { acquireSpecialPlayer, getSpecialPackOffers, SpecialAcquisitionError } from "../src/players/special-acquisition-service.js";

test("special pack offers expose fixed server-owned prices and rarity tiers", () => {
  assert.deepEqual(getSpecialPackOffers(), [
    { method: "epic_pack", rarity: "EPIC", priceGold: "10" },
    { method: "legendary_pack", rarity: "LEGENDARY", priceGold: "25" },
    { method: "icon_pack", rarity: "ICON", priceGold: "50" },
  ]);
});

test("special acquisition rejects malformed idempotency keys before database access", async () => {
  await assert.rejects(
    acquireSpecialPlayer("user-1", "epic_pack", "bad"),
    (error: unknown) => error instanceof SpecialAcquisitionError && error.code === "INVALID_IDEMPOTENCY_KEY",
  );
});

test("special acquisition rejects unsupported pack methods before database access", async () => {
  await assert.rejects(
    acquireSpecialPlayer("user-1", "free_pack" as "epic_pack", "request-123"),
    (error: unknown) => error instanceof SpecialAcquisitionError && error.code === "INVALID_ACQUISITION_METHOD",
  );
});
