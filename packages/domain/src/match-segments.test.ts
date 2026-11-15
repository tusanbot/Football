import assert from "node:assert/strict";
import test from "node:test";
import { advanceMatchSegment, type MatchSegmentState } from "./match-segments.js";
import type { MatchSide } from "./match-engine.js";

function side(clubId: string, overall: number): MatchSide {
  const positions = ["GK","RB","CB","CB","LB","CDM","CM","CAM","RW","ST","LW"] as const;
  return {
    clubId, clubName: clubId, formation: "4-3-3",
    tactics: { mentality: "BALANCED", pressing: "MID_BLOCK", tempo: "NORMAL", passingStyle: "MIXED" },
    stadiumCapacity: 10000, ticketPrice: 50n, reputation: 20, coachMedicalSkill: 30,
    players: positions.map((position, index) => ({
      id: clubId + "-p" + index, name: "Player " + index, position, overall,
      morale: 75, fitness: 95,
      attributes: { pace: overall, shooting: overall, passing: overall, dribbling: overall,
        defending: overall, physical: overall, goalkeeping: position === "GK" ? overall + 5 : 25 },
    })),
  };
}
function initialState(): MatchSegmentState {
  return {
    currentMinute: 0, nextSequence: 1,
    home: { side: side("home", 75), score: 0, expectedGoals: 0 },
    away: { side: side("away", 65), score: 0, expectedGoals: 0 },
    events: [],
  };
}
test("segment advancement is deterministic and accumulates the score and timeline", () => {
  const input = { seed: "segment-fixture-1", state: initialState(), toMinute: 45 as const };
  const first = advanceMatchSegment(input);
  const replay = advanceMatchSegment(input);
  assert.deepEqual(first, replay);
  assert.equal(first.state.currentMinute, 45);
  assert.equal(first.state.nextSequence, first.events.length + 1);
  assert.equal(first.state.events.length, first.events.length);
  assert.equal(first.state.home.score, first.events.filter((event) => event.type === "GOAL" && event.teamId === "home").length);
});
test("manager tactics are applied to the next segment only", () => {
  const state = advanceMatchSegment({ seed: "segment-fixture-2", state: initialState(), toMinute: 45 }).state;
  const next = advanceMatchSegment({
    seed: "segment-fixture-2", state, toMinute: 60,
    homeInstruction: { mentality: "ATTACKING", tempo: "FAST", formation: "4-2-4" },
  });
  assert.equal(next.state.home.side.tactics.mentality, "ATTACKING");
  assert.equal(next.state.home.side.tactics.tempo, "FAST");
  assert.equal(next.state.home.side.formation, "4-2-4");
  assert.equal(next.state.away.side.tactics.mentality, "BALANCED");
});
test("segments must advance from supported boundaries and cannot run past full time", () => {
  const state = initialState();
  assert.throws(() => advanceMatchSegment({ seed: "x", state, toMinute: 60 }), /INVALID_MATCH_SEGMENT_RANGE/);
  const half = advanceMatchSegment({ seed: "x", state, toMinute: 45 }).state;
  assert.throws(() => advanceMatchSegment({ seed: "x", state: half, toMinute: 45 }), /INVALID_MATCH_SEGMENT_RANGE/);
});
