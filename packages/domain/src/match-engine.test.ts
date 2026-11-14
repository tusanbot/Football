import assert from "node:assert/strict";
import test from "node:test";
import { simulateFootballMatch, type MatchSide } from "./match-engine.js";

function side(clubId: string, overall: number): MatchSide {
  const positions = ["GK","RB","CB","CB","LB","CDM","CM","CAM","RW","ST","LW"] as const;
  return {
    clubId, clubName: clubId, formation: "4-3-3",
    tactics: { mentality: "BALANCED", pressing: "MID_BLOCK", tempo: "NORMAL", passingStyle: "MIXED" },
    stadiumCapacity: 12000, ticketPrice: 50n, reputation: 20,
    players: positions.map((position, index) => ({
      id: clubId + "-p" + index, name: "Player " + index, position, overall,
      morale: 75, fitness: 95,
      attributes: {
        pace: overall, shooting: overall, passing: overall, dribbling: overall,
        defending: overall, physical: overall, goalkeeping: position === "GK" ? overall + 5 : 25,
      },
    })),
  };
}

test("match simulation is deterministic, produces valid score/events/performance and gate revenue", () => {
  const input = { seed: "fixture-seed-001", home: side("home", 75), away: side("away", 58) };
  const first = simulateFootballMatch(input);
  const replay = simulateFootballMatch(input);
  assert.deepEqual(first, replay);
  assert.ok(first.homeScore >= 0 && first.awayScore >= 0);
  assert.equal(first.performances.length, 22);
  assert.equal(first.performances.reduce((sum, row) => sum + row.goals, 0), first.homeScore + first.awayScore);
  assert.ok(first.events.every((event) => event.minute >= 1 && event.minute <= 90));
  assert.ok(first.attendance >= 0 && first.attendance <= 12000);
  assert.equal(first.ticketRevenue, BigInt(first.attendance) * 50n);
  assert.ok(first.performances.every((row) => row.rating >= 3 && row.rating <= 10));
});

test("match simulation rejects invalid sides", () => {
  assert.throws(() => simulateFootballMatch({
    seed: "same", home: side("same", 60), away: side("same", 60),
  }), /MATCH_TEAMS_MUST_DIFFER/);
  const incomplete = side("incomplete", 60);
  incomplete.players.pop();
  assert.throws(() => simulateFootballMatch({
    seed: "short", home: incomplete, away: side("away", 60),
  }), /MATCH_REQUIRES_ELEVEN_PLAYERS/);
});
