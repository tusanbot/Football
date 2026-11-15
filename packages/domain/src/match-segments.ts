import type { MatchSide, MatchTactics, MatchEvent } from "./match-engine.js";
import {
  applyMatchSubstitutions,
  type MatchSubstitutionState,
} from "./match-rules.js";

export type MatchSegmentSideState = {
  side: MatchSide;
  score: number;
  expectedGoals: number;
};

export type MatchSegmentState = {
  currentMinute: number;
  nextSequence: number;
  home: MatchSegmentSideState;
  away: MatchSegmentSideState;
  events: MatchEvent[];
};

export type MatchSegmentInstruction = Partial<MatchTactics> & { formation?: string };

export type MatchSegmentResult = {
  state: MatchSegmentState;
  fromMinute: number;
  toMinute: number;
  events: MatchEvent[];
  homeSubstitutions: MatchSubstitutionState;
  awaySubstitutions: MatchSubstitutionState;
  substitutionErrors: string[];
};

/** Stable small PRNG: every segment can be replayed after a worker restart. */
function createRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const isAttacker = (position: string) => ["ST", "RW", "LW", "CAM", "CF"].includes(position);
const isDefender = (position: string) => ["CB", "LB", "RB", "CDM", "GK"].includes(position);

function effectiveAttack(side: MatchSide): number {
  const players = side.players;
  if (players.length < 7 || players.length > 11) throw new Error("MATCH_REQUIRES_SEVEN_TO_ELEVEN_PLAYERS");
  // Keep 11 as the denominator: every missing player after a sending-off
  // reduces the team's effective strength for the following segment.
  const average = players.reduce((sum, player) =>
    sum + player.overall * (0.75 + player.fitness / 400 + player.morale / 800), 0) / 11;
  const attacking = players.reduce((sum, player) =>
    sum + (player.attributes.shooting * 0.5 + player.attributes.pace * 0.2
      + player.attributes.dribbling * 0.15 + player.attributes.passing * 0.15)
      * (isAttacker(player.position) ? 1.3 : 0.78), 0) / 11;
  const defensive = players.reduce((sum, player) =>
    sum + (player.attributes.defending * 0.55 + player.attributes.physical * 0.25
      + player.attributes.pace * 0.2) * (isDefender(player.position) ? 1.2 : 0.8), 0) / 11;
  const mentality = side.tactics.mentality === "ATTACKING" ? 1.09
    : side.tactics.mentality === "DEFENSIVE" ? 0.91 : 1;
  const tempo = side.tactics.tempo === "FAST" ? 1.04 : side.tactics.tempo === "SLOW" ? 0.96 : 1;
  const pressing = side.tactics.pressing === "HIGH_PRESS" ? 1.025 : 1;
  return clamp((average * 0.35 + attacking * 0.65) * mentality * tempo * pressing - defensive * 0.12, 12, 100);
}

function applyInstruction(side: MatchSide, instruction?: MatchSegmentInstruction): MatchSide {
  if (!instruction) return side;
  const tactics: MatchTactics = {
    mentality: instruction.mentality ?? side.tactics.mentality,
    pressing: instruction.pressing ?? side.tactics.pressing,
    tempo: instruction.tempo ?? side.tactics.tempo,
    passingStyle: instruction.passingStyle ?? side.tactics.passingStyle,
  };
  return { ...side, formation: instruction.formation ?? side.formation, tactics };
}

function choose<T>(items: T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

/**
 * Advance exactly one persisted match segment. It is deterministic for the
 * fixture seed and minute range, so a retried worker computes the same output.
 * The caller persists the returned state with a compare-and-set stateVersion.
 */
export function advanceMatchSegment(input: {
  seed: string;
  state: MatchSegmentState;
  toMinute: 45 | 60 | 75 | 90;
  homeInstruction?: MatchSegmentInstruction;
  awayInstruction?: MatchSegmentInstruction;
  homeSubstitutions?: MatchSubstitutionState;
  awaySubstitutions?: MatchSubstitutionState;
}): MatchSegmentResult {
  const { state, toMinute } = input;
  const fromMinute = state.currentMinute;
  const expectedNextMinute = fromMinute === 0 ? 45 : fromMinute === 45 ? 60 : fromMinute === 60 ? 75 : fromMinute === 75 ? 90 : null;
  if (expectedNextMinute === null || toMinute !== expectedNextMinute) {
    throw new Error("INVALID_MATCH_SEGMENT_RANGE");
  }
  if (state.home.side.clubId === state.away.side.clubId) {
    throw new Error("MATCH_TEAMS_MUST_DIFFER");
  }
  if (!Number.isInteger(state.nextSequence) || state.nextSequence < 1) {
    throw new Error("INVALID_MATCH_EVENT_SEQUENCE");
  }
  const home = applyInstruction(state.home.side, input.homeInstruction);
  const away = applyInstruction(state.away.side, input.awayInstruction);
  const random = createRandom(`${input.seed}:${fromMinute}-${toMinute}`);
  const duration = toMinute - fromMinute;
  const homeAttack = effectiveAttack(home);
  const awayAttack = effectiveAttack(away);
  const homeChance = clamp(0.9 + (homeAttack - effectiveAttack(away)) / 80, 0.25, 1.8) * duration / 45;
  const awayChance = clamp(0.85 + (awayAttack - effectiveAttack(home)) / 85, 0.2, 1.7) * duration / 45;
  const events: MatchEvent[] = [];
  let sequence = state.nextSequence;
  const addEvent = (event: Omit<MatchEvent, "sequence">) => {
    events.push({ ...event, sequence: sequence++ });
  };
  const scoreSide = (side: MatchSide, chance: number) => {
    const expectedGoals = chance;
    const goals = Math.floor(expectedGoals) + (random() < expectedGoals % 1 ? 1 : 0);
    for (let index = 0; index < goals; index++) {
      const candidates = side.players.filter((player) => isAttacker(player.position));
      const scorer = choose(candidates.length ? candidates : side.players, random);
      const helpers = side.players.filter((player) => player.id !== scorer.id);
      const assister = random() < 0.72 && helpers.length ? choose(helpers, random) : null;
      const minute = fromMinute + 1 + Math.floor(random() * duration);
      addEvent({
        minute, type: "GOAL", teamId: side.clubId, playerId: scorer.id,
        ...(assister ? { relatedPlayerId: assister.id } : {}),
        detail: assister ? "Goal scored; assist recorded." : "Goal scored.",
      });
    }
    return { goals, expectedGoals };
  };
  const homeResult = scoreSide(home, homeChance);
  const awayResult = scoreSide(away, awayChance);
  for (const side of [home, away]) {
    const outfield = side.players.filter((player) => player.position !== "GK");
    if (outfield.length && random() < duration / 45 * 0.32) {
      const player = choose(outfield, random);
      addEvent({
        minute: fromMinute + 1 + Math.floor(random() * duration),
        type: "YELLOW_CARD", teamId: side.clubId, playerId: player.id, detail: "Caution.",
      });
    }
    if (outfield.length && random() < duration / 45 * 0.035) {
      const player = choose(outfield, random);
      addEvent({
        minute: fromMinute + 1 + Math.floor(random() * duration),
        type: "RED_CARD", teamId: side.clubId, playerId: player.id,
        detail: "Sent off. The team continues with one fewer player.",
      });
    }
    const injuryChance = clamp(
      (0.13 + (side.tactics.pressing === "HIGH_PRESS" ? 0.04 : side.tactics.pressing === "LOW_BLOCK" ? -0.02 : 0)
        - side.coachMedicalSkill * 0.0007) * duration / 90,
      0.002, 0.18,
    );
    if (outfield.length && random() < injuryChance) {
      const player = choose(outfield, random);
      addEvent({
        minute: fromMinute + 1 + Math.floor(random() * duration),
        type: "INJURY", teamId: side.clubId, playerId: player.id,
        detail: "Player suffered an in-match injury.",
      });
    }
  }

  const fallbackSubstitutionState = (side: MatchSide): MatchSubstitutionState => ({
    onPitch: side.players.map(({ id, position }) => ({ id, position })),
    bench: (side.bench ?? []).map(({ id, position }) => ({ id, position })),
    substitutionsUsed: 0, inPlayWindowsUsed: 0, substitutedOutIds: [],
    sentOffIds: [], usedCheckpointIds: [],
  });
  const substitutionStates = new Map<string, {
    side: MatchSide;
    state: MatchSubstitutionState;
  }>([
    [home.clubId, { side: home, state: input.homeSubstitutions ?? fallbackSubstitutionState(home) }],
    [away.clubId, { side: away, state: input.awaySubstitutions ?? fallbackSubstitutionState(away) }],
  ]);
  const substitutionErrors: string[] = [];
  const orderedEvents = [...events].sort((a, b) => a.minute - b.minute || a.sequence - b.sequence);
  const processedEvents: MatchEvent[] = [];
  for (const event of orderedEvents) {
    const current = substitutionStates.get(event.teamId);
    if (!current) continue;
    let nextEvent = event;
    if (event.type === "GOAL") {
      const activeIds = new Set(current.side.players.map((player) => player.id));
      if (!activeIds.has(event.playerId)) {
        const scorers = current.side.players.filter((player) => isAttacker(player.position));
        const scorer = choose(scorers.length ? scorers : current.side.players, random);
        const helpers = current.side.players.filter((player) => player.id !== scorer.id);
        const assister = random() < 0.72 && helpers.length ? choose(helpers, random) : null;
        nextEvent = {
          ...event, playerId: scorer.id,
          ...(assister ? { relatedPlayerId: assister.id } : { relatedPlayerId: undefined }),
        };
      } else if (event.relatedPlayerId && !activeIds.has(event.relatedPlayerId)) {
        const helpers = current.side.players.filter((player) => player.id !== event.playerId);
        const assister = helpers.length ? choose(helpers, random) : null;
        nextEvent = { ...event, ...(assister ? { relatedPlayerId: assister.id } : { relatedPlayerId: undefined }) };
      }
    }
    processedEvents.push(nextEvent);
    if (event.type === "RED_CARD") {
      const dismissed = current.side.players.find((player) => player.id === event.playerId);
      if (dismissed) {
        current.side = { ...current.side, players: current.side.players.filter((player) => player.id !== event.playerId) };
        current.state = {
          ...current.state,
          onPitch: current.state.onPitch.filter((player) => player.id !== event.playerId),
          sentOffIds: [...current.state.sentOffIds, event.playerId],
        };
        substitutionStates.set(event.teamId, current);
      }
    }
    if (event.type === "INJURY") {
      const injured = current.side.players.find((player) => player.id === event.playerId);
      if (injured) {
        const role = (position: string) => position === "GK" ? "GK"
          : ["CB", "LB", "RB"].includes(position) ? "DEF"
            : ["CDM", "CM", "CAM"].includes(position) ? "MID" : "ATT";
        const incoming = (current.side.bench ?? [])
          .filter((player) => role(player.position) === role(injured.position))
          .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))[0];
        if (incoming) {
          try {
            const checkpointId = "injury-" + input.seed + "-" + event.minute + "-" + injured.id;
            const applied = applyMatchSubstitutions({
              state: current.state,
              changes: [{ outgoingPlayerId: injured.id, incomingPlayerId: incoming.id }],
              checkpoint: "INJURY",
              checkpointId,
              source: "FORCED_INJURY",
            });
            const players = new Map([...current.side.players, ...(current.side.bench ?? [])].map((player) => [player.id, player]));
            current.side = {
              ...current.side,
              players: applied.state.onPitch.map((player) => players.get(player.id)!).filter(Boolean),
              bench: applied.state.bench.map((player) => players.get(player.id)!).filter(Boolean),
            };
            current.state = applied.state;
            processedEvents.push({
              sequence: sequence++,
              minute: event.minute,
              type: "SUBSTITUTION",
              teamId: event.teamId,
              playerId: injured.id,
              relatedPlayerId: incoming.id,
              detail: "Forced injury substitution: " + injured.name + " replaced by " + incoming.name + ".",
            });
            substitutionStates.set(event.teamId, current);
          } catch (error) {
            substitutionErrors.push(event.teamId + ":" + (error instanceof Error ? error.message : "FORCED_INJURY_SUBSTITUTION_FAILED"));
            current.side = { ...current.side, players: current.side.players.filter((player) => player.id !== injured.id) };
            current.state = {
              ...current.state,
              onPitch: current.state.onPitch.filter((player) => player.id !== injured.id),
              substitutedOutIds: [...current.state.substitutedOutIds, injured.id],
            };
            substitutionStates.set(event.teamId, current);
          }
        } else {
          // No legal replacement: the injured player leaves and the side plays short.
          current.side = { ...current.side, players: current.side.players.filter((player) => player.id !== injured.id) };
          current.state = {
            ...current.state,
            onPitch: current.state.onPitch.filter((player) => player.id !== injured.id),
            substitutedOutIds: [...current.state.substitutedOutIds, injured.id],
          };
          substitutionStates.set(event.teamId, current);
        }
      }
    }
  }
  const resequenced = processedEvents
    .sort((a, b) => a.minute - b.minute || a.sequence - b.sequence)
    .map((event, index) => ({ ...event, sequence: state.nextSequence + index }));
  const homeSubstitutions = substitutionStates.get(home.clubId)!.state;
  const awaySubstitutions = substitutionStates.get(away.clubId)!.state;
  const homeFinal = substitutionStates.get(home.clubId)!.side;
  const awayFinal = substitutionStates.get(away.clubId)!.side;
  const resultState: MatchSegmentState = {
    currentMinute: toMinute,
    nextSequence: state.nextSequence + resequenced.length,
    home: {
      side: homeFinal, score: state.home.score + homeResult.goals,
      expectedGoals: state.home.expectedGoals + homeResult.expectedGoals,
    },
    away: {
      side: awayFinal, score: state.away.score + awayResult.goals,
      expectedGoals: state.away.expectedGoals + awayResult.expectedGoals,
    },
    events: [...state.events, ...resequenced],
  };
  return {
    state: resultState, fromMinute, toMinute, events: resequenced,
    homeSubstitutions, awaySubstitutions, substitutionErrors,
  };
}
