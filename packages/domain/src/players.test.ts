import test from "node:test";
import assert from "node:assert/strict";
import { generatePlayer, generateStarterSquad, NATIONAL_POOLS } from "./players.js";

function seededRandom() {
  let value = 17;
  return (min: number, max: number) => {
    value = (value * 48271) % 2147483647;
    return min + (value % (max - min));
  };
}

test("name pools contain at least 100 first and last names", () => {
  assert.equal(NATIONAL_POOLS.reduce((n, p) => n + p.first.length, 0), 100);
  assert.equal(NATIONAL_POOLS.reduce((n, p) => n + p.last.length, 0), 100);
});

test("starter squad has 18 players with the intended position balance", () => {
  const squad = generateStarterSquad(seededRandom());
  assert.equal(squad.length, 18);
  assert.equal(squad.filter((p) => p.position === "GK").length, 2);
  assert.ok(squad.every((p) => p.overall >= 42 && p.overall <= 65));
  assert.ok(squad.every((p) => p.potential >= p.overall && p.potential <= 88));
  assert.ok(squad.every((p) => p.wage > 0n && p.contractDays >= 180));
  assert.ok(squad.every((p) => p.nationality.length === 2));
});

test("goalkeepers receive goalkeeper-focused attributes", () => {
  const player = generatePlayer("GK", seededRandom());
  assert.ok(player.attributes.goalkeeping >= 20);
});
