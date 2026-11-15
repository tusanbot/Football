import assert from "node:assert/strict";
import test from "node:test";
import {
  isMatchCheckpointDecisionWindowOpen, resolveMatchCheckpoint,
  type MatchCheckpointDecision, type MatchCheckpointWindow,
} from "./match-checkpoints.js";
const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
const window: MatchCheckpointWindow = {
  checkpointId: "match-1:HALF_TIME", checkpoint: "HALF_TIME",
  openedAt: at(0), decisionDeadlineAt: at(60), nextSegmentAt: at(20),
  homeClubId: "home", awayClubId: "away",
};
test("decision window closes at the next segment even if its nominal deadline is later", () => {
  assert.equal(isMatchCheckpointDecisionWindowOpen(window, at(0)), true);
  assert.equal(isMatchCheckpointDecisionWindowOpen(window, at(19)), true);
  assert.equal(isMatchCheckpointDecisionWindowOpen(window, at(20)), false);
});
test("scheduled segment resolves without either manager responding", () => {
  const result = resolveMatchCheckpoint({
    window, now: at(20), decisions: [],
    fallback: { home: "home-plan", away: "away-plan" },
    aiDefaults: { home: "home-ai", away: "away-ai" },
  });
  assert.equal(result.home.source, "PREMATCH_PLAN");
  assert.equal(result.away.source, "PREMATCH_PLAN");
  assert.equal(result.resolvedAt.getTime(), at(20).getTime());
});
test("latest timely manager decision overrides fallback independently for each club", () => {
  const decisions: MatchCheckpointDecision<string>[] = [
    { id: "h1", clubId: "home", submittedAt: at(5), instruction: "home-first" },
    { id: "h2", clubId: "home", submittedAt: at(8), instruction: "home-latest" },
    { id: "a1", clubId: "away", submittedAt: at(10), instruction: "away-choice" },
  ];
  const result = resolveMatchCheckpoint({
    window, now: at(20), decisions,
    fallback: { home: "home-plan", away: "away-plan" },
    aiDefaults: { home: "home-ai", away: "away-ai" },
  });
  assert.equal(result.home.instruction, "home-latest");
  assert.equal(result.home.decisionId, "h2");
  assert.equal(result.away.instruction, "away-choice");
  assert.equal(result.home.source, "MANAGER");
  assert.equal(result.away.source, "MANAGER");
});
test("late and pre-checkpoint decisions are ignored and AI is the final fallback", () => {
  const decisions: MatchCheckpointDecision<string>[] = [
    { id: "late", clubId: "home", submittedAt: at(21), instruction: "late-choice" },
    { id: "early", clubId: "away", submittedAt: at(-1), instruction: "early-choice" },
  ];
  const result = resolveMatchCheckpoint({
    window, now: at(20), decisions,
    fallback: { home: null, away: null },
    aiDefaults: { home: "home-ai", away: "away-ai" },
  });
  assert.equal(result.home.source, "AI");
  assert.equal(result.away.source, "AI");
});
test("decision deadline is enforced even when segment starts later", () => {
  const shortWindow = { ...window, decisionDeadlineAt: at(10), nextSegmentAt: at(20) };
  const result = resolveMatchCheckpoint({
    window: shortWindow, now: at(20),
    decisions: [{ id: "expired", clubId: "home", submittedAt: at(11), instruction: "late" }],
    fallback: { home: "plan", away: "plan" }, aiDefaults: { home: "ai", away: "ai" },
  });
  assert.equal(result.home.instruction, "plan");
  assert.equal(result.home.source, "PREMATCH_PLAN");
});
test("checkpoint cannot resolve before its scheduled segment start", () => {
  assert.throws(() => resolveMatchCheckpoint({
    window, now: at(19), decisions: [], fallback: { home: "plan", away: "plan" },
    aiDefaults: { home: "ai", away: "ai" },
  }), /MATCH_CHECKPOINT_SEGMENT_NOT_DUE/);
});
test("invalid checkpoint windows are rejected", () => {
  assert.throws(() => resolveMatchCheckpoint({
    window: { ...window, decisionDeadlineAt: at(-1) }, now: at(20), decisions: [],
    fallback: { home: "plan", away: "plan" }, aiDefaults: { home: "ai", away: "ai" },
  }), /INVALID_MATCH_CHECKPOINT_WINDOW/);
});
