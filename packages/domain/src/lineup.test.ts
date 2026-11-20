import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultLineup, validateLineup } from "./lineup.js";

const squad = [
  { id: "gk", position: "GK" as const, overall: 60 },
  { id: "rb", position: "RB" as const, overall: 55 },
  { id: "cb1", position: "CB" as const, overall: 58 },
  { id: "cb2", position: "CB" as const, overall: 57 },
  { id: "lb", position: "LB" as const, overall: 54 },
  { id: "cdm", position: "CDM" as const, overall: 56 },
  { id: "cm", position: "CM" as const, overall: 59 },
  { id: "cam", position: "CAM" as const, overall: 61 },
  { id: "rw", position: "RW" as const, overall: 60 },
  { id: "st", position: "ST" as const, overall: 62 },
  { id: "lw", position: "LW" as const, overall: 58 },
];

test("validates a complete 4-3-3 lineup", () => {
  assert.deepEqual(validateLineup("4-3-3", squad), { valid: true, errors: [] });
});

test("rejects duplicate players and missing goalkeeper", () => {
  const invalid = [...squad];
  invalid[0] = { ...invalid[1]!, id: "rb-copy" };
  const result = validateLineup("4-3-3", invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("goalkeeper")));
});

test("rejects position-incompatible lineup slots", () => {
  const invalid = [...squad];
  invalid[1] = { ...invalid[1]!, position: "ST" };
  const result = validateLineup("4-3-3", invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("slot 2")));
});

test("builds a deterministic strongest-available default lineup", () => {
  const candidates = [...squad, { id: "backup-gk", position: "GK" as const, overall: 90 }];
  const lineup = buildDefaultLineup(candidates);
  assert.ok(lineup);
  assert.equal(lineup[0], "backup-gk");
  assert.equal(new Set(lineup).size, 11);
});

test("returns null when a complete default lineup cannot be formed", () => {
  assert.equal(buildDefaultLineup(squad.slice(1)), null);
});
