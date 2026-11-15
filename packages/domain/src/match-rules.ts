import type { PlayerPosition } from "./players.js";

export type MatchSubstitutionCheckpoint =
  | "HALF_TIME"
  | "MINUTE_60"
  | "MINUTE_75"
  | "INJURY";

export type MatchSubstitutionSource = "MANAGER" | "PREMATCH_PLAN" | "AI" | "FORCED_INJURY";

export type MatchSubstitutionPlayer = {
  id: string;
  position: PlayerPosition;
};

export type MatchSubstitution = {
  outgoingPlayerId: string;
  incomingPlayerId: string;
};

export type MatchSubstitutionRules = {
  maxSubstitutions: number;
  maxInPlayWindows: number;
};

export const DEFAULT_MATCH_SUBSTITUTION_RULES: Readonly<MatchSubstitutionRules> = Object.freeze({
  maxSubstitutions: 5,
  maxInPlayWindows: 3,
});

export type MatchSubstitutionState = {
  onPitch: MatchSubstitutionPlayer[];
  bench: MatchSubstitutionPlayer[];
  substitutionsUsed: number;
  inPlayWindowsUsed: number;
  substitutedOutIds: string[];
  sentOffIds: string[];
  usedCheckpointIds: string[];
};

export type MatchSubstitutionResult = {
  state: MatchSubstitutionState;
  substitutions: Array<MatchSubstitution & {
    checkpoint: MatchSubstitutionCheckpoint;
    checkpointId: string;
    source: MatchSubstitutionSource;
  }>;
};

/**
 * Apply a complete substitution package atomically.
 *
 * Half-time substitutions count toward the five-player match limit, but do
 * not consume one of the three in-play substitution windows. Every in-play
 * change, including a forced injury replacement, consumes the same limits.
 */
export function applyMatchSubstitutions(input: {
  state: MatchSubstitutionState;
  changes: MatchSubstitution[];
  checkpoint: MatchSubstitutionCheckpoint;
  checkpointId: string;
  source: MatchSubstitutionSource;
  rules?: MatchSubstitutionRules;
}): MatchSubstitutionResult {
  const rules = input.rules ?? DEFAULT_MATCH_SUBSTITUTION_RULES;
  const { state, changes } = input;

  if (!input.checkpointId.trim()) throw new Error("MATCH_SUBSTITUTION_CHECKPOINT_ID_REQUIRED");
  if (!Number.isInteger(rules.maxSubstitutions) || rules.maxSubstitutions < 0
    || !Number.isInteger(rules.maxInPlayWindows) || rules.maxInPlayWindows < 0) {
    throw new Error("INVALID_MATCH_SUBSTITUTION_RULES");
  }
  if (!changes.length) throw new Error("MATCH_SUBSTITUTION_EMPTY");
  if (state.usedCheckpointIds.includes(input.checkpointId)) {
    throw new Error("MATCH_SUBSTITUTION_CHECKPOINT_ALREADY_USED");
  }
  if (state.substitutionsUsed + changes.length > rules.maxSubstitutions) {
    throw new Error("MATCH_SUBSTITUTION_LIMIT_REACHED");
  }
  const isHalfTime = input.checkpoint === "HALF_TIME";
  if (!isHalfTime && state.inPlayWindowsUsed >= rules.maxInPlayWindows) {
    throw new Error("MATCH_SUBSTITUTION_WINDOWS_EXHAUSTED");
  }

  const onPitch = new Map(state.onPitch.map((player) => [player.id, player]));
  const bench = new Map(state.bench.map((player) => [player.id, player]));
  if (onPitch.size !== state.onPitch.length || bench.size !== state.bench.length
    || [...onPitch.keys()].some((id) => bench.has(id))) {
    throw new Error("MATCH_SUBSTITUTION_INVALID_ROSTER");
  }
  const sentOff = new Set(state.sentOffIds);
  const alreadyOut = new Set(state.substitutedOutIds);
  if ([...sentOff].some((id) => onPitch.has(id))) {
    throw new Error("MATCH_SUBSTITUTION_SENT_OFF_PLAYER_ON_PITCH");
  }

  const outgoingIds = new Set<string>();
  const incomingIds = new Set<string>();
  const nextOnPitch = new Map(onPitch);
  const nextBench = new Map(bench);

  for (const change of changes) {
    if (change.outgoingPlayerId === change.incomingPlayerId
      || outgoingIds.has(change.outgoingPlayerId)
      || incomingIds.has(change.incomingPlayerId)) {
      throw new Error("MATCH_SUBSTITUTION_DUPLICATE_PLAYER");
    }
    const outgoing = nextOnPitch.get(change.outgoingPlayerId);
    const incoming = nextBench.get(change.incomingPlayerId);
    if (!outgoing || !incoming) throw new Error("MATCH_SUBSTITUTION_PLAYER_NOT_AVAILABLE");
    if (sentOff.has(outgoing.id) || sentOff.has(incoming.id) || alreadyOut.has(outgoing.id)) {
      throw new Error("MATCH_SUBSTITUTION_PLAYER_INELIGIBLE");
    }
    outgoingIds.add(outgoing.id);
    incomingIds.add(incoming.id);
    nextOnPitch.delete(outgoing.id);
    nextOnPitch.set(incoming.id, incoming);
    nextBench.delete(incoming.id);
    nextBench.set(outgoing.id, outgoing);
  }

  if (![...nextOnPitch.values()].some((player) => player.position === "GK")) {
    throw new Error("MATCH_SUBSTITUTION_GOALKEEPER_REQUIRED");
  }

  const nextState: MatchSubstitutionState = {
    onPitch: [...nextOnPitch.values()],
    bench: [...nextBench.values()],
    substitutionsUsed: state.substitutionsUsed + changes.length,
    inPlayWindowsUsed: state.inPlayWindowsUsed + (isHalfTime ? 0 : 1),
    substitutedOutIds: [...state.substitutedOutIds, ...outgoingIds],
    sentOffIds: [...state.sentOffIds],
    usedCheckpointIds: [...state.usedCheckpointIds, input.checkpointId],
  };

  return {
    state: nextState,
    substitutions: changes.map((change) => ({
      ...change,
      checkpoint: input.checkpoint,
      checkpointId: input.checkpointId,
      source: input.source,
    })),
  };
}
