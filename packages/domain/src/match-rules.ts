import type { PlayerPosition } from "./players.js";

export type MatchSubstitutionCheckpoint = "HALF_TIME" | "MINUTE_60" | "MINUTE_75" | "INJURY";
export type MatchSubstitutionSource = "MANAGER" | "PREMATCH_PLAN" | "AI" | "FORCED_INJURY";
export type MatchSubstitutionPlayer = { id: string; position: PlayerPosition };
export type MatchSubstitution = { outgoingPlayerId: string; incomingPlayerId: string };

export type MatchSubstitutionRules = {
  maxSubstitutions: number;
  maxInPlayWindows: number;
};

export type MatchRules = MatchSubstitutionRules & {
  injuriesEnabled: boolean;
  injuryDurationDays: number;
  redCardSuspensionMatches: number;
  yellowCardsToSuspend: number;
  yellowCardSuspensionMatches: number;
  penaltiesOnDraw: boolean;
};

export const DEFAULT_MATCH_RULES: Readonly<MatchRules> = Object.freeze({
  maxSubstitutions: 5,
  maxInPlayWindows: 3,
  injuriesEnabled: true,
  injuryDurationDays: 5,
  redCardSuspensionMatches: 1,
  yellowCardsToSuspend: 3,
  yellowCardSuspensionMatches: 1,
  penaltiesOnDraw: false,
});

export const DEFAULT_MATCH_SUBSTITUTION_RULES: Readonly<MatchSubstitutionRules> = Object.freeze({ maxSubstitutions: 5, maxInPlayWindows: 3 });

export const DEFAULT_CUP_MATCH_RULES: Readonly<MatchRules> = Object.freeze({
  ...DEFAULT_MATCH_RULES,
  penaltiesOnDraw: true,
});

export function validateMatchRules(value: unknown): MatchRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_MATCH_RULES");
  }
  const input = { ...DEFAULT_MATCH_RULES, ...(value as Record<string, unknown>) };
  const rules: MatchRules = {
    maxSubstitutions: Number(input.maxSubstitutions),
    maxInPlayWindows: Number(input.maxInPlayWindows),
    injuriesEnabled: input.injuriesEnabled as boolean,
    injuryDurationDays: Number(input.injuryDurationDays),
    redCardSuspensionMatches: Number(input.redCardSuspensionMatches),
    yellowCardsToSuspend: Number(input.yellowCardsToSuspend),
    yellowCardSuspensionMatches: Number(input.yellowCardSuspensionMatches),
    penaltiesOnDraw: input.penaltiesOnDraw as boolean,
  };
  if (!Number.isInteger(rules.maxSubstitutions) || rules.maxSubstitutions < 0 || rules.maxSubstitutions > 7
    || !Number.isInteger(rules.maxInPlayWindows) || rules.maxInPlayWindows < 0 || rules.maxInPlayWindows > 3
    || rules.maxInPlayWindows > rules.maxSubstitutions
    || !Number.isInteger(rules.redCardSuspensionMatches) || rules.redCardSuspensionMatches < 0 || rules.redCardSuspensionMatches > 5
    || !Number.isInteger(rules.yellowCardsToSuspend) || rules.yellowCardsToSuspend < 0 || rules.yellowCardsToSuspend > 10
    || !Number.isInteger(rules.yellowCardSuspensionMatches) || rules.yellowCardSuspensionMatches < 0 || rules.yellowCardSuspensionMatches > 5
    || !Number.isInteger(rules.injuryDurationDays) || rules.injuryDurationDays < 1 || rules.injuryDurationDays > 14
    || typeof rules.injuriesEnabled !== "boolean" || typeof rules.penaltiesOnDraw !== "boolean") {
    throw new Error("INVALID_MATCH_RULES");
  }
  if (rules.yellowCardsToSuspend === 0 && rules.yellowCardSuspensionMatches > 0) {
    throw new Error("INVALID_YELLOW_CARD_SUSPENSION_RULES");
  }
  return rules;
}

export function defaultMatchRules(format: "FRIENDLY" | "LEAGUE" | "CUP"): MatchRules {
  return { ...(format === "CUP" ? DEFAULT_CUP_MATCH_RULES : DEFAULT_MATCH_RULES) };
}

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

export function applyMatchSubstitutions(input: {
  state: MatchSubstitutionState;
  changes: MatchSubstitution[];
  checkpoint: MatchSubstitutionCheckpoint;
  checkpointId: string;
  source: MatchSubstitutionSource;
  rules?: MatchSubstitutionRules;
}): MatchSubstitutionResult {
  const rules = input.rules ?? DEFAULT_MATCH_RULES;
  const { state, changes } = input;
  if (!input.checkpointId.trim()) throw new Error("MATCH_SUBSTITUTION_CHECKPOINT_ID_REQUIRED");
  if (!Number.isInteger(rules.maxSubstitutions) || rules.maxSubstitutions < 0
    || !Number.isInteger(rules.maxInPlayWindows) || rules.maxInPlayWindows < 0
    || rules.maxSubstitutions > 7 || rules.maxInPlayWindows > 3
    || rules.maxInPlayWindows > rules.maxSubstitutions) throw new Error("INVALID_MATCH_SUBSTITUTION_RULES");
  if (!changes.length) throw new Error("MATCH_SUBSTITUTION_EMPTY");
  if (state.usedCheckpointIds.includes(input.checkpointId)) throw new Error("MATCH_SUBSTITUTION_CHECKPOINT_ALREADY_USED");
  if (state.substitutionsUsed + changes.length > rules.maxSubstitutions) throw new Error("MATCH_SUBSTITUTION_LIMIT_REACHED");
  const isHalfTime = input.checkpoint === "HALF_TIME";
  if (!isHalfTime && state.inPlayWindowsUsed >= rules.maxInPlayWindows) throw new Error("MATCH_SUBSTITUTION_WINDOWS_EXHAUSTED");
  const onPitch = new Map(state.onPitch.map((player) => [player.id, player]));
  const bench = new Map(state.bench.map((player) => [player.id, player]));
  if (onPitch.size !== state.onPitch.length || bench.size !== state.bench.length
    || [...onPitch.keys()].some((id) => bench.has(id))) throw new Error("MATCH_SUBSTITUTION_INVALID_ROSTER");
  const sentOff = new Set(state.sentOffIds);
  const alreadyOut = new Set(state.substitutedOutIds);
  if ([...sentOff].some((id) => onPitch.has(id))) throw new Error("MATCH_SUBSTITUTION_SENT_OFF_PLAYER_ON_PITCH");
  const outgoingIds = new Set<string>();
  const incomingIds = new Set<string>();
  const nextOnPitch = new Map(onPitch);
  const nextBench = new Map(bench);
  for (const change of changes) {
    if (change.outgoingPlayerId === change.incomingPlayerId || outgoingIds.has(change.outgoingPlayerId)
      || incomingIds.has(change.incomingPlayerId)) throw new Error("MATCH_SUBSTITUTION_DUPLICATE_PLAYER");
    const outgoing = nextOnPitch.get(change.outgoingPlayerId);
    const incoming = nextBench.get(change.incomingPlayerId);
    if (!outgoing || !incoming) throw new Error("MATCH_SUBSTITUTION_PLAYER_NOT_AVAILABLE");
    if (sentOff.has(outgoing.id) || sentOff.has(incoming.id) || alreadyOut.has(outgoing.id)) throw new Error("MATCH_SUBSTITUTION_PLAYER_INELIGIBLE");
    outgoingIds.add(outgoing.id); incomingIds.add(incoming.id);
    nextOnPitch.delete(outgoing.id); nextOnPitch.set(incoming.id, incoming);
    nextBench.delete(incoming.id); nextBench.set(outgoing.id, outgoing);
  }
  if (![...nextOnPitch.values()].some((player) => player.position === "GK")) throw new Error("MATCH_SUBSTITUTION_GOALKEEPER_REQUIRED");
  return {
    state: {
      onPitch: [...nextOnPitch.values()], bench: [...nextBench.values()],
      substitutionsUsed: state.substitutionsUsed + changes.length,
      inPlayWindowsUsed: state.inPlayWindowsUsed + (isHalfTime ? 0 : 1),
      substitutedOutIds: [...state.substitutedOutIds, ...outgoingIds],
      sentOffIds: [...state.sentOffIds], usedCheckpointIds: [...state.usedCheckpointIds, input.checkpointId],
    },
    substitutions: changes.map((change) => ({ ...change, checkpoint: input.checkpoint, checkpointId: input.checkpointId, source: input.source })),
  };
}
