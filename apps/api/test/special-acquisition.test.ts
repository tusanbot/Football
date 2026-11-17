import assert from "node:assert/strict";
import test from "node:test";
import { acquireSpecialPlayer, getSpecialPackOffers, SpecialAcquisitionError } from "../src/players/special-acquisition-service.js";
import { SPECIAL_PLAYER_CATALOG } from "../src/players/special-catalog.js";

test("special pack offers expose fixed server-owned prices and rarity tiers", () => {
  assert.deepEqual(getSpecialPackOffers(), [
    { method: "epic_pack", rarity: "EPIC", priceGold: "250", maxCopiesPerPlayer: 10 },
    { method: "legendary_pack", rarity: "LEGENDARY", priceGold: "2500", maxCopiesPerPlayer: 3 },
    { method: "icon_pack", rarity: "ICON", priceGold: "25000", maxCopiesPerPlayer: 1 },
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

test("classic icons are excluded from ordinary icon packs", () => {
  for (const slug of ["pele", "diego-maradona", "marco-van-basten"]) {
    const player = SPECIAL_PLAYER_CATALOG.find((item) => item.slug === slug);
    assert.ok(player, "missing classic player " + slug);
    assert.ok(!player.acquisitionMethods.includes("icon_pack" as never));
  }
});
