import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMatchSubstitutions,
  DEFAULT_MATCH_SUBSTITUTION_RULES,
  defaultMatchRules,
  validateMatchRules,
  type MatchSubstitutionState,
} from "./match-rules.js";
import type { PlayerPosition } from "./players.js";

const positions: PlayerPosition[] = ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CAM", "RW", "ST", "LW"];
function state(): MatchSubstitutionState {
  return {
    onPitch: positions.map((position, index) => ({ id: "p" + index, position })),
    bench: (["GK", "RB", "CB", "CM", "ST", "LW"] as PlayerPosition[])
      .map((position, index) => ({ id: "b" + index, position })),
    substitutionsUsed: 0,
    inPlayWindowsUsed: 0,
    substitutedOutIds: [],
    sentOffIds: [],
    usedCheckpointIds: [],
  };
}

test("half-time substitutions count toward five but not the three in-play windows", () => {
  const result = applyMatchSubstitutions({
    state: state(),
    changes: [
      { outgoingPlayerId: "p1", incomingPlayerId: "b1" },
      { outgoingPlayerId: "p9", incomingPlayerId: "b4" },
    ],
    checkpoint: "HALF_TIME",
    checkpointId: "half-time",
    source: "MANAGER",
  });
  assert.equal(result.state.substitutionsUsed, 2);
  assert.equal(result.state.inPlayWindowsUsed, 0);
  assert.equal(result.state.onPitch.length, 11);
  assert.ok(result.state.onPitch.some((player) => player.id === "b1"));
  assert.ok(result.state.onPitch.some((player) => player.id === "b4"));
});

test("the five-substitution cap includes half-time and later substitutions", () => {
  let current = applyMatchSubstitutions({
    state: state(),
    changes: [
      { outgoingPlayerId: "p1", incomingPlayerId: "b1" },
      { outgoingPlayerId: "p9", incomingPlayerId: "b4" },
    ],
    checkpoint: "HALF_TIME", checkpointId: "ht", source: "MANAGER",
  }).state;
  current = applyMatchSubstitutions({
    state: current,
    changes: [{ outgoingPlayerId: "p2", incomingPlayerId: "b2" }],
    checkpoint: "MINUTE_60", checkpointId: "m60", source: "MANAGER",
  }).state;
  current = applyMatchSubstitutions({
    state: current,
    changes: [{ outgoingPlayerId: "p6", incomingPlayerId: "b3" }],
    checkpoint: "MINUTE_75", checkpointId: "m75", source: "MANAGER",
  }).state;
  assert.equal(current.substitutionsUsed, 4);
  assert.equal(current.inPlayWindowsUsed, 2);
  assert.throws(() => applyMatchSubstitutions({
    state: current,
    changes: [
      { outgoingPlayerId: "p3", incomingPlayerId: "b5" },
      { outgoingPlayerId: "p4", incomingPlayerId: "b0" },
    ],
    checkpoint: "INJURY", checkpointId: "injury-1", source: "FORCED_INJURY",
  }), /MATCH_SUBSTITUTION_LIMIT_REACHED/);
});

test("the three in-play windows are independent from the five-player limit", () => {
  let current = state();
  const substitutions = [
    ["p1", "b1", "m60"],
    ["p2", "b2", "m75"],
    ["p3", "b4", "injury"],
  ] as const;
  for (const [outgoingPlayerId, incomingPlayerId, checkpointId] of substitutions) {
    const checkpoint = checkpointId === "m60" ? "MINUTE_60" : checkpointId === "m75" ? "MINUTE_75" : "INJURY";
    current = applyMatchSubstitutions({
      state: current,
      changes: [{ outgoingPlayerId, incomingPlayerId }],
      checkpoint,
      checkpointId,
      source: checkpoint === "INJURY" ? "FORCED_INJURY" : "MANAGER",
    }).state;
  }
  assert.equal(current.substitutionsUsed, 3);
  assert.equal(current.inPlayWindowsUsed, 3);
  assert.throws(() => applyMatchSubstitutions({
    state: current,
    changes: [{ outgoingPlayerId: "p4", incomingPlayerId: "b5" }],
    checkpoint: "INJURY", checkpointId: "injury-2", source: "FORCED_INJURY",
  }), /MATCH_SUBSTITUTION_WINDOWS_EXHAUSTED/);
});

test("invalid batches are rejected atomically and duplicate checkpoint requests are blocked", () => {
  const initial = state();
  assert.throws(() => applyMatchSubstitutions({
    state: initial,
    changes: [
      { outgoingPlayerId: "p1", incomingPlayerId: "b1" },
      { outgoingPlayerId: "p1", incomingPlayerId: "b2" },
    ],
    checkpoint: "HALF_TIME", checkpointId: "ht", source: "MANAGER",
  }), /MATCH_SUBSTITUTION_DUPLICATE_PLAYER/);
  assert.equal(initial.substitutionsUsed, 0);
  const applied = applyMatchSubstitutions({
    state: initial,
    changes: [{ outgoingPlayerId: "p1", incomingPlayerId: "b1" }],
    checkpoint: "HALF_TIME", checkpointId: "ht", source: "MANAGER",
  });
  assert.throws(() => applyMatchSubstitutions({
    state: applied.state,
    changes: [{ outgoingPlayerId: "p2", incomingPlayerId: "b2" }],
    checkpoint: "HALF_TIME", checkpointId: "ht", source: "MANAGER",
  }), /MATCH_SUBSTITUTION_CHECKPOINT_ALREADY_USED/);
});

test("a goalkeeper cannot leave unless another goalkeeper remains on the pitch", () => {
  const initial = state();
  assert.throws(() => applyMatchSubstitutions({
    state: initial,
    changes: [{ outgoingPlayerId: "p0", incomingPlayerId: "b1" }],
    checkpoint: "HALF_TIME", checkpointId: "ht", source: "MANAGER",
  }), /MATCH_SUBSTITUTION_GOALKEEPER_REQUIRED/);
  const result = applyMatchSubstitutions({
    state: initial,
    changes: [{ outgoingPlayerId: "p0", incomingPlayerId: "b0" }],
    checkpoint: "HALF_TIME", checkpointId: "ht", source: "MANAGER",
  });
  assert.equal(result.state.onPitch.find((player) => player.position === "GK")?.id, "b0");
});

test("default substitution rules expose the agreed five-player and three-window limits", () => {
  assert.deepEqual(DEFAULT_MATCH_SUBSTITUTION_RULES, { maxSubstitutions: 5, maxInPlayWindows: 3 });
});


test("competition rule defaults distinguish league, cup and friendly formats", () => {
  assert.equal(defaultMatchRules("LEAGUE").penaltiesOnDraw, false);
  assert.equal(defaultMatchRules("FRIENDLY").yellowCardsToSuspend, 3);
  assert.equal(defaultMatchRules("CUP").penaltiesOnDraw, true);
});

test("competition rule validation rejects impossible limits and accepts customized rules", () => {
  const custom = {
    maxSubstitutions: 4, maxInPlayWindows: 2, injuriesEnabled: false, injuryDurationDays: 5,
    redCardSuspensionMatches: 2, yellowCardsToSuspend: 4,
    yellowCardSuspensionMatches: 2, penaltiesOnDraw: true,
  };
  assert.deepEqual(validateMatchRules(custom), custom);
  assert.throws(() => validateMatchRules({ ...custom, maxInPlayWindows: 5 }), /INVALID_MATCH_RULES/);
  assert.throws(() => validateMatchRules({ ...custom, yellowCardsToSuspend: 0 }), /INVALID_YELLOW_CARD_SUSPENSION_RULES/);
  assert.throws(() => applyMatchSubstitutions({
    state: state(), changes: [{ outgoingPlayerId: "p1", incomingPlayerId: "b1" }],
    checkpoint: "HALF_TIME", checkpointId: "invalid-rule-cap", source: "MANAGER",
    rules: { maxSubstitutions: 8, maxInPlayWindows: 3 },
  }), /INVALID_MATCH_SUBSTITUTION_RULES/);
});
