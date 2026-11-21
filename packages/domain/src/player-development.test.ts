import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePlayerDailyState,
  applyAnnualAgeing,
  calculateInjuryChanceBasisPoints,
  calculatePlayerOverall,
  calculateTrainingResult,
  calculateContractDemand,
  calculatePayrollSettlement,
  isTrainingFocusCompatible,
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

test("goalkeeping focus is reserved for goalkeepers", () => {
  assert.equal(isTrainingFocusCompatible("GK", "GOALKEEPING"), true);
  assert.equal(isTrainingFocusCompatible("ST", "GOALKEEPING"), false);
  assert.equal(isTrainingFocusCompatible("ST", "SHOOTING"), true);
});

test("contract demand stays within a deterministic wage range", () => {
  const demand = calculateContractDemand({
    age: 21, overall: 60, potential: 80, morale: 90, currentWeeklyWage: 150n,
  });
  assert.ok(demand.minimumWeeklyWage >= 150n);
  assert.equal(demand.maximumWeeklyWage, demand.minimumWeeklyWage * 2n);
});

test("annual ageing gradually reduces pace and physical attributes", () => {
  const result = applyAnnualAgeing("ST", attributes, 33, 2);
  assert.equal(result.attributes.pace, attributes.pace - 3);
  assert.equal(result.attributes.physical, attributes.physical - 3);
  assert.ok(result.overall <= calculatePlayerOverall("ST", attributes));
});

test("weekly payroll prorates expiring contracts and excludes retired players", () => {
  const payroll = calculatePayrollSettlement({
    players: [
      { weeklyWage: 70n, contractDays: 7, status: "ACTIVE" },
      { weeklyWage: 140n, contractDays: 3, status: "INJURED" },
      { weeklyWage: 300n, contractDays: 0, status: "CONTRACT_EXPIRED" },
      { weeklyWage: 500n, contractDays: 7, status: "RETIRED" },
    ],
    coachWeeklyWage: 100n,
    elapsedDays: 7,
    weeksCovered: 1,
    arrearsBefore: 0n,
    cashAvailable: 1_000n,
  });
  assert.equal(payroll.playerWages, 130n);
  assert.equal(payroll.coachWages, 100n);
  assert.equal(payroll.totalDue, 230n);
  assert.equal(payroll.cashPaid, 230n);
  assert.equal(payroll.playersCount, 2);
});

test("weekly payroll carries unpaid balances forward without overdrawing cash", () => {
  const payroll = calculatePayrollSettlement({
    players: [{ weeklyWage: 300n, contractDays: 30, status: "ACTIVE" }],
    coachWeeklyWage: 100n,
    elapsedDays: 7,
    weeksCovered: 1,
    arrearsBefore: 50n,
    cashAvailable: 200n,
  });
  assert.equal(payroll.totalDue, 450n);
  assert.equal(payroll.cashPaid, 200n);
  assert.equal(payroll.arrearsAfter, 250n);
});

test("listed players continue losing contract days and listings expire at contract end", () => {
  const result = advancePlayerDailyState({
    contractDays: 2, fitness: 40, morale: 60, status: "LISTED", injuryUntil: null,
  }, 3, new Date("2026-11-14T00:00:00.000Z"), 60);
  assert.equal(result.contractDays, 0);
  assert.equal(result.status, "CONTRACT_EXPIRED");
  assert.ok(result.fitness > 40);
});
