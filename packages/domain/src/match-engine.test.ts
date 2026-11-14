import assert from "node:assert/strict";
import test from "node:test";
import { simulateFootballMatch, simulatePenaltyShootout, type MatchSide } from "./match-engine.js";

function side(clubId: string, overall: number): MatchSide {
  const positions = ["GK","RB","CB","CB","LB","CDM","CM","CAM","RW","ST","LW"] as const;
  return {
    clubId, clubName: clubId, formation: "4-3-3",
    tactics: { mentality: "BALANCED", pressing: "MID_BLOCK", tempo: "NORMAL", passingStyle: "MIXED" },
    stadiumCapacity: 12000, ticketPrice: 50n, reputation: 20, coachMedicalSkill: 35,
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
  assert.deepEqual(first.events.map((event) => event.minute), [...first.events.map((event) => event.minute)].sort((a, b) => a - b));
  assert.ok(first.attendance >= 0 && first.attendance <= 12000);
  assert.equal(first.ticketRevenue, BigInt(first.attendance) * 50n);
  assert.ok(first.performances.every((row) => row.rating >= 3 && row.rating <= 10));
});

test("match simulation uses the bench and records deterministic substitutions and realistic minutes", () => {
  const home = side("home-bench", 74);
  const away = side("away-bench", 69);
  const benchPositions = ["RB", "CB", "CM", "ST", "LW"] as const;
  home.bench = benchPositions.map((position, index) => ({
    ...home.players[index + 1]!, id: "home-bench-sub-" + index, name: "Home substitute " + index, position,
  }));
  away.bench = benchPositions.map((position, index) => ({
    ...away.players[index + 1]!, id: "away-bench-sub-" + index, name: "Away substitute " + index, position,
  }));
  const result = simulateFootballMatch({ seed: "substitution-seed-2026", home, away });
  const substitutions = result.events.filter((event) => event.type === "SUBSTITUTION");
  assert.ok(substitutions.length >= 1);
  assert.ok(substitutions.length <= 10);
  for (const event of substitutions) {
    assert.ok(event.relatedPlayerId);
    const outgoing = result.performances.find((line) => line.playerId === event.playerId)!;
    const incoming = result.performances.find((line) => line.playerId === event.relatedPlayerId)!;
    assert.equal(outgoing.minutesPlayed + incoming.minutesPlayed, 90);
    assert.ok(outgoing.minutesPlayed >= 8 && outgoing.minutesPlayed < 90);
    assert.ok(incoming.minutesPlayed > 0 && incoming.minutesPlayed < 90);
  }
  assert.equal(result.performances.length, 32);
  assert.ok(result.performances.some((line) => line.minutesPlayed === 0) === false);
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

test("penalty shootout is deterministic and always resolves a winner", () => {
  const input = { seed: "cup-final-001", home: side("home", 72), away: side("away", 65) };
  const first = simulatePenaltyShootout(input);
  const replay = simulatePenaltyShootout(input);
  assert.deepEqual(first, replay);
  assert.notEqual(first.homePenalties, first.awayPenalties);
  assert.ok(first.homePenalties >= 0 && first.awayPenalties >= 0);
  assert.equal(first.winner, first.homePenalties > first.awayPenalties ? "HOME" : "AWAY");
});
