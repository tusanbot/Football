import type { PlayerPosition } from "./players.js";

export const FORMATION_SLOTS = {
  "4-3-3": [
    ["GK"], ["RB"], ["CB"], ["CB"], ["LB"],
    ["CDM"], ["CM"], ["CAM"], ["RW"], ["ST"], ["LW"],
  ],
  "4-4-2": [
    ["GK"], ["RB"], ["CB"], ["CB"], ["LB"],
    ["CM", "CDM"], ["CM", "CDM"], ["RW", "RB"], ["LW", "LB"], ["ST"], ["ST"],
  ],
  "3-5-2": [
    ["GK"], ["CB"], ["CB"], ["CB"], ["CDM", "RB"],
    ["CM", "CDM"], ["CM"], ["CAM", "CM"], ["RW", "RB"], ["ST"], ["ST", "LW"],
  ],
  "4-2-3-1": [
    ["GK"], ["RB"], ["CB"], ["CB"], ["LB"],
    ["CDM", "CM"], ["CDM", "CM"], ["CAM", "CM"], ["RW", "LW"], ["LW", "RW"], ["ST"],
  ],
} as const satisfies Record<string, readonly (readonly PlayerPosition[])[]>;

export type Formation = keyof typeof FORMATION_SLOTS;
export type LineupCandidate = { id: string; position: PlayerPosition; overall: number };

export function validateLineup(formation: Formation, players: readonly LineupCandidate[]) {
  const errors: string[] = [];
  if (players.length !== 11) errors.push("A lineup must contain exactly 11 players.");
  if (new Set(players.map((player) => player.id)).size !== players.length) {
    errors.push("A player cannot occupy more than one lineup slot.");
  }

  const slots = FORMATION_SLOTS[formation];
  players.slice(0, 11).forEach((player, index) => {
    const accepted = slots[index];
    if (accepted && !accepted.includes(player.position as never)) {
      errors.push(`Player in slot ${index + 1} cannot play the required position.`);
    }
  });

  if (players.filter((player) => player.position === "GK").length !== 1) {
    errors.push("A lineup must contain exactly one goalkeeper.");
  }

  return { valid: errors.length === 0, errors };
}

/** Picks the highest-rated eligible player for each slot of the default 4-3-3. */
export function buildDefaultLineup(players: readonly LineupCandidate[]): string[] | null {
  const available = [...players].sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
  const selected: string[] = [];
  for (const accepted of FORMATION_SLOTS["4-3-3"]) {
    const index = available.findIndex((player) => accepted.includes(player.position as never));
    if (index < 0) return null;
    selected.push(available[index]!.id);
    available.splice(index, 1);
  }
  return selected;
}
