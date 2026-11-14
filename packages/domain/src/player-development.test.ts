import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePlayerDailyState,
  calculateInjuryChanceBasisPoints,
  calculatePlayerOverall,
  calculateTrainingResult,
} from "./player-development.js";
import type { PlayerAttributes } from "./players.js";

const attributes: PlayerAttributes = {
  pace: 60, shooting: 55, passing: 58, dribbling: 57,
  defending: 40, physical: 62, goalkeeping: 25,
};

const base = {
  age: 20, position: "ST" as const, overall: 58, potential: 82,
  attributes, fitness: 90, morale: 75,
};

test("focused training improves the requested attribute without exceeding potential", () => {
  const result = calculateTrainingResult(base, "SHOOTING", "INTENSE", 80, 3, 9999);
  assert.ok(result.attributes.shooting > base.attributes.shooting);
  assert.ok(result.overall >= base.overall);
  assert.ok(result.overall <= base.potential);
  assert.equal(result.fitness, 80);
});

test("balanced training improves a small set of complementary attributes", () => {
  const result = calculateTrainingResult(base, "BALANCED", "NORMAL", 70, 1, 9999);
  assert.ok(result.attributes.pace > base.attributes.pace);
  assert.ok(result.attributes.passing > base.attributes.passing);
  assert.ok(result.attributes.physical > base.attributes.physical);
  assert.equal(result.attributes.shooting, base.attributes.shooting);
});

test("older players develop more slowly than young players", () => {
  const young = calculateTrainingResult(base, "SHOOTING", "NORMAL", 50, 1, 9000);
  const old = calculateTrainingResult({ ...base, age: 34 }, "SHOOTING", "NORMAL", 50, 1, 9000);
  assert.ok(young.attributeGain >= old.attributeGain);
});

test("overall is calculated using positional weights", () => {
  const goalkeeper = calculatePlayerOverall("GK", { ...attributes, goalkeeping: 90 });
  const striker = calculatePlayerOverall("ST", { ...attributes, shooting: 90 });
  assert.ok(goalkeeper > calculatePlayerOverall("GK", attributes));
  assert.ok(striker > calculatePlayerOverall("ST", attributes));
});

test("injury risk rises with intensity and fatigue and falls with medical skill", () => {
  const freshLight = calculateInjuryChanceBasisPoints(100, "LIGHT", 0);
  const tiredIntense = calculateInjuryChanceBasisPoints(25, "INTENSE", 0);
  const medicallySupported = calculateInjuryChanceBasisPoints(25, "INTENSE", 90);
  assert.ok(tiredIntense > freshLight);
  assert.ok(medicallySupported < tiredIntense);
});

test("daily recovery reduces contracts, restores fitness and resolves injuries", () => {
  const result = advancePlayerDailyState({
    contractDays: 30, fitness: 40, morale: 70, status: "INJURED",
    injuryUntil: new Date("2026-11-10T00:00:00.000Z"),
  }, 5, new Date("2026-11-14T00:00:00.000Z"), 80);
  assert.equal(result.contractDays, 25);
  assert.equal(result.status, "ACTIVE");
  assert.ok(result.fitness > 40);
  assert.equal(result.injuryUntil, null);
});

test("expired contracts suspend players until renewed", () => {
  const result = advancePlayerDailyState({
    contractDays: 1, fitness: 90, morale: 75, status: "ACTIVE", injuryUntil: null,
  }, 3, new Date("2026-11-14T00:00:00.000Z"), 30);
  assert.equal(result.contractDays, 0);
  assert.equal(result.status, "CONTRACT_EXPIRED");
});
