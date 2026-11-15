import assert from "node:assert/strict";
import test from "node:test";
import {
  allocatePyramidLeagueApplications,
  assertPyramidLeagueReady,
  canStartPyramidLeague,
} from "./league-pyramid-registration.js";

const applications = (count: number) => Array.from({ length: count }, (_, index) => ({
  clubId: `club-${index + 1}`,
  appliedAt: new Date(Date.UTC(2026, 0, index + 1)),
}));

test("allocates only complete eight-team groups and keeps the remainder queued", () => {
  const result = allocatePyramidLeagueApplications({
    applications: applications(19), tier: 2, season: 3,
  });
  assert.equal(result.groupsFilled, 2);
  assert.equal(result.assignments.length, 16);
  assert.deepEqual(result.queuedClubIds, ["club-17", "club-18", "club-19"]);
  assert.equal(result.assignments[0]?.groupNumber, 1);
  assert.equal(result.assignments[7]?.groupNumber, 1);
  assert.equal(result.assignments[8]?.groupNumber, 2);
  assert.equal(result.assignments[15]?.groupNumber, 2);
});

test("preserves FIFO application order and uses club id as a stable tie-breaker", () => {
  const result = allocatePyramidLeagueApplications({
    applications: [
      { clubId: "zeta", appliedAt: new Date("2026-01-01T00:00:00Z") },
      { clubId: "alpha", appliedAt: new Date("2026-01-01T00:00:00Z") },
      ...applications(6),
    ],
    tier: 1, season: 1,
  });
  assert.equal(result.assignments.length, 8);
  assert.equal(result.assignments[0]?.clubId, "alpha");
  assert.equal(result.assignments[1]?.clubId, "zeta");
});

test("does not start an incomplete league", () => {
  assert.equal(canStartPyramidLeague(7), false);
  assert.equal(canStartPyramidLeague(8), true);
  assert.equal(canStartPyramidLeague(9), false);
  assert.throws(() => assertPyramidLeagueReady(7), /PYRAMID_LEAGUE_REQUIRES_EIGHT_TEAMS/);
  assert.doesNotThrow(() => assertPyramidLeagueReady(8));
});

test("rejects duplicate applications and invalid league metadata", () => {
  assert.throws(() => allocatePyramidLeagueApplications({
    applications: [applications(1)[0]!, applications(1)[0]!], tier: 1, season: 1,
  }), /DUPLICATE_LEAGUE_APPLICATION/);
  assert.throws(() => allocatePyramidLeagueApplications({
    applications: [], tier: 8, season: 1,
  }), /INVALID_LEAGUE_TIER/);
  assert.throws(() => allocatePyramidLeagueApplications({
    applications: [], tier: 1, season: 0,
  }), /INVALID_LEAGUE_SEASON/);
});
