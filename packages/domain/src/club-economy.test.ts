import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAcademyScoutCost,
  calculateCoachUpgradeCost,
  calculateDailyOperatingCost,
  calculateFacilityUpgradeCost,
  calculateProspectRecruitmentCost,
  calculateStadiumCapacity,
  getSponsorOffers,
} from "./club-economy.js";

test("facility upgrades scale by level and reject capped facilities", () => {
  assert.equal(calculateFacilityUpgradeCost("STADIUM", 1), 4_000n);
  assert.equal(calculateFacilityUpgradeCost("TRAINING_GROUND", 2), 10_000n);
  assert.equal(calculateFacilityUpgradeCost("ACADEMY", 0), 3_500n);
  assert.throws(() => calculateFacilityUpgradeCost("STADIUM", 10));
});

test("stadium capacity and daily operating costs are deterministic", () => {
  assert.equal(calculateStadiumCapacity(1), 1_000);
  assert.equal(calculateStadiumCapacity(2), 1_400);
  assert.equal(calculateStadiumCapacity(10), 20_700);
  assert.equal(calculateDailyOperatingCost({ stadiumLevel: 2, trainingGroundLevel: 1, academyLevel: 3 }), 85n);
});

test("academy scouting and recruitment costs validate academy progression", () => {
  assert.throws(() => calculateAcademyScoutCost(0));
  assert.equal(calculateAcademyScoutCost(2), 2_500n);
  assert.equal(calculateProspectRecruitmentCost(45, 75, 2), 4_100n);
  assert.throws(() => calculateProspectRecruitmentCost(80, 70, 2));
});

test("sponsor offers unlock only when club level and reputation requirements are met", () => {
  assert.deepEqual(getSponsorOffers(1, 0).map((offer) => offer.id), ["local-partner"]);
  assert.deepEqual(getSponsorOffers(2, 50).map((offer) => offer.id), ["local-partner", "regional-brand"]);
  assert.deepEqual(getSponsorOffers(3, 150).map((offer) => offer.id), ["local-partner", "regional-brand", "national-network"]);
});

test("coach progression costs rise with each level", () => {
  assert.equal(calculateCoachUpgradeCost(1), 1_500n);
  assert.equal(calculateCoachUpgradeCost(3), 13_500n);
  assert.throws(() => calculateCoachUpgradeCost(10));
});
