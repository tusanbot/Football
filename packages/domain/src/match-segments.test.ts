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


function withBench(source: MatchSide): MatchSide {
  const benchPositions = ["RB", "CB", "CM", "ST", "GK", "RW", "LB"] as const;
  return {
    ...source,
    bench: benchPositions.map((position, index) => ({
      id: source.clubId + "-bench-" + index,
      name: "Bench " + index,
      position,
      overall: 70,
      morale: 75,
      fitness: 95,
      attributes: { pace: 70, shooting: 70, passing: 70, dribbling: 70,
        defending: 70, physical: 70, goalkeeping: position === "GK" ? 75 : 25 },
    })),
  };
}
function substitutionsFor(source: MatchSide) {
  return {
    onPitch: source.players.map(({ id, position }) => ({ id, position })),
    bench: (source.bench ?? []).map(({ id, position }) => ({ id, position })),
    substitutionsUsed: 0,
    inPlayWindowsUsed: 0,
    substitutedOutIds: [] as string[],
    sentOffIds: [] as string[],
    usedCheckpointIds: [] as string[],
  };
}

test("segmented injuries create a forced legal substitution and consume one in-play window", () => {
  const home = withBench(side("home", 75));
  const away = side("away", 65);
  const state: MatchSegmentState = {
    currentMinute: 0, nextSequence: 1,
    home: { side: home, score: 0, expectedGoals: 0 },
    away: { side: away, score: 0, expectedGoals: 0 },
    events: [],
  };
  const result = advanceMatchSegment({
    seed: "forced-match-seed-6",
    state,
    toMinute: 45,
    homeSubstitutions: substitutionsFor(home),
    awaySubstitutions: substitutionsFor(away),
  });
  const injury = result.events.find((event) => event.type === "INJURY" && event.teamId === "home");
  assert.ok(injury);
  const forced = result.events.find((event) =>
    event.type === "SUBSTITUTION" && event.teamId === "home" && event.minute === injury.minute);
  assert.ok(forced);
  assert.equal(result.homeSubstitutions.substitutionsUsed, 1);
  assert.equal(result.homeSubstitutions.inPlayWindowsUsed, 1);
  assert.ok(!result.state.home.side.players.some((player) => player.id === injury.playerId));
  assert.ok(result.state.home.side.players.some((player) => player.id === forced.relatedPlayerId));
});

test("segmented red cards remove the dismissed player and weaken the next segment", () => {
  const state = initialState();
  const result = advanceMatchSegment({
    seed: "forced-match-seed-28",
    state,
    toMinute: 45,
    homeSubstitutions: substitutionsFor(state.home.side),
    awaySubstitutions: substitutionsFor(state.away.side),
  });
  const redCard = result.events.find((event) => event.type === "RED_CARD" && event.teamId === "away");
  assert.ok(redCard);
  assert.equal(result.state.away.side.players.length, 10);
  assert.ok(result.awaySubstitutions.sentOffIds.includes(redCard.playerId));
  assert.ok(!result.awaySubstitutions.onPitch.some((player) => player.id === redCard.playerId));
  const next = advanceMatchSegment({
    seed: "forced-match-seed-28",
    state: result.state,
    toMinute: 60,
    homeSubstitutions: result.homeSubstitutions,
    awaySubstitutions: result.awaySubstitutions,
  });
  assert.equal(next.state.away.side.players.length, 10);
});


test("segmented player statistics track minutes and output across injury substitutions", () => {
  const home = withBench(side("home", 75));
  const away = withBench(side("away", 65));
  const initial: MatchSegmentState = {
    currentMinute: 0, nextSequence: 1,
    home: { side: home, score: 0, expectedGoals: 0 },
    away: { side: away, score: 0, expectedGoals: 0 },
    events: [],
  };
  const first = advanceMatchSegment({
    seed: "forced-match-seed-6", state: initial, toMinute: 45,
    homeSubstitutions: substitutionsFor(home), awaySubstitutions: substitutionsFor(away),
  });
  const injury = first.events.find((event) => event.type === "INJURY" && event.teamId === "home")!;
  const forced = first.events.find((event) =>
    event.type === "SUBSTITUTION" && event.teamId === "home" && event.minute === injury.minute)!;
  const firstStats = new Map((first.state.playerStats ?? []).map((item) => [item.playerId, item]));
  assert.equal(firstStats.get(injury.playerId)?.minutesPlayed, injury.minute);
  assert.equal(firstStats.get(forced.relatedPlayerId!)?.minutesPlayed, 45 - injury.minute);
  const starter = home.players.find((player) => player.id !== injury.playerId && player.position !== "GK")!;
  assert.equal(firstStats.get(starter.id)?.minutesPlayed, 45);
  assert.ok((firstStats.get(starter.id)?.passes ?? 0) > 0);
  assert.ok((firstStats.get(starter.id)?.fitnessLoss ?? 0) > 0);

  const second = advanceMatchSegment({
    seed: "forced-match-seed-6", state: first.state, toMinute: 60,
    homeSubstitutions: first.homeSubstitutions, awaySubstitutions: first.awaySubstitutions,
  });
  const secondStats = new Map((second.state.playerStats ?? []).map((item) => [item.playerId, item]));
  assert.ok((secondStats.get(starter.id)?.minutesPlayed ?? 0) >= 45);
  assert.ok((secondStats.get(starter.id)?.minutesPlayed ?? 0) <= 60);
  assert.equal(secondStats.get(injury.playerId)?.minutesPlayed, injury.minute);
  assert.ok((secondStats.get(forced.relatedPlayerId!)?.minutesPlayed ?? 0) >= 45 - injury.minute);
  assert.ok((secondStats.get(forced.relatedPlayerId!)?.minutesPlayed ?? 0) <= 60 - injury.minute);
});
