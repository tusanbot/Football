export type MatchTacticalCheckpoint = "HALF_TIME" | "MINUTE_60" | "MINUTE_75";
export type MatchCheckpointDecisionSource = "MANAGER" | "PREMATCH_PLAN" | "AI";
export type MatchCheckpointWindow = {
  checkpointId: string;
  checkpoint: MatchTacticalCheckpoint;
  openedAt: Date;
  decisionDeadlineAt: Date;
  nextSegmentAt: Date;
  homeClubId: string;
  awayClubId: string;
};
export type MatchCheckpointDecision<TInstruction> = {
  id: string;
  clubId: string;
  submittedAt: Date;
  instruction: TInstruction;
};
export type MatchCheckpointPlan<TInstruction> = { home: TInstruction | null; away: TInstruction | null };
export type ResolvedMatchCheckpointInstruction<TInstruction> = {
  clubId: string;
  source: MatchCheckpointDecisionSource;
  instruction: TInstruction;
  decisionId: string | null;
};
export type MatchCheckpointResolution<TInstruction> = {
  checkpointId: string;
  checkpoint: MatchTacticalCheckpoint;
  resolvedAt: Date;
  home: ResolvedMatchCheckpointInstruction<TInstruction>;
  away: ResolvedMatchCheckpointInstruction<TInstruction>;
};

/** The response window runs alongside the match clock; it never blocks progression. */
export function isMatchCheckpointDecisionWindowOpen(window: MatchCheckpointWindow, now: Date): boolean {
  const cutoff = Math.min(window.decisionDeadlineAt.getTime(), window.nextSegmentAt.getTime());
  return now.getTime() >= window.openedAt.getTime() && now.getTime() < cutoff;
}

/**
 * Resolve both clubs independently at the server-owned segment boundary.
 * Timely manager decision > saved pre-match plan > safe AI default.
 * No response is required for this function to resolve the checkpoint.
 */
export function resolveMatchCheckpoint<TInstruction>(input: {
  window: MatchCheckpointWindow;
  now: Date;
  decisions: MatchCheckpointDecision<TInstruction>[];
  fallback: MatchCheckpointPlan<TInstruction>;
  aiDefaults: MatchCheckpointPlan<TInstruction>;
}): MatchCheckpointResolution<TInstruction> {
  const { window, now } = input;
  if (!window.checkpointId.trim()) throw new Error("MATCH_CHECKPOINT_ID_REQUIRED");
  if (window.homeClubId === window.awayClubId) throw new Error("MATCH_CHECKPOINT_TEAMS_MUST_DIFFER");
  if (window.openedAt.getTime() > window.nextSegmentAt.getTime()
    || window.decisionDeadlineAt.getTime() < window.openedAt.getTime()) {
    throw new Error("INVALID_MATCH_CHECKPOINT_WINDOW");
  }
  if (now.getTime() < window.nextSegmentAt.getTime()) throw new Error("MATCH_CHECKPOINT_SEGMENT_NOT_DUE");
  const cutoff = Math.min(window.decisionDeadlineAt.getTime(), window.nextSegmentAt.getTime());
  const resolveFor = (
    clubId: string,
    fallbackInstruction: TInstruction | null,
    aiDefaultInstruction: TInstruction,
  ): ResolvedMatchCheckpointInstruction<TInstruction> => {
    const timely = input.decisions
      .filter((decision) => decision.clubId === clubId
        && decision.submittedAt.getTime() >= window.openedAt.getTime()
        && decision.submittedAt.getTime() <= cutoff
        && decision.submittedAt.getTime() <= now.getTime())
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || a.id.localeCompare(b.id))[0];
    if (timely) return { clubId, source: "MANAGER" as const, instruction: timely.instruction, decisionId: timely.id };
    if (fallbackInstruction !== null) {
      return { clubId, source: "PREMATCH_PLAN", instruction: fallbackInstruction, decisionId: null };
    }
    return { clubId, source: "AI", instruction: aiDefaultInstruction, decisionId: null };
  };
  return {
    checkpointId: window.checkpointId, checkpoint: window.checkpoint, resolvedAt: now,
    home: resolveFor(window.homeClubId, input.fallback.home, input.aiDefaults.home),
    away: resolveFor(window.awayClubId, input.fallback.away, input.aiDefaults.away),
  };
}
