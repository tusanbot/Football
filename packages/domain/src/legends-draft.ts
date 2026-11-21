export type DraftLine = "GK" | "DEF" | "MID" | "ATT";
export type DraftFormation = "2-2" | "1-2-1" | "1-1-2" | "2-1-1";

export interface DraftPoolPlayer {
  id: string;
  name: string;
  line: DraftLine;
  overall: number;
}

export interface DraftPick {
  pickNumber: number;
  userId: string;
  player: DraftPoolPlayer;
}

export interface LegendsDraftState {
  users: readonly [string, string];
  pool: readonly DraftPoolPlayer[];
  picks: readonly DraftPick[];
  status: "DRAFTING" | "COMPLETE";
}

export const LEGENDS_DRAFT_FORMATIONS: Readonly<Record<DraftFormation, Readonly<Record<Exclude<DraftLine, "GK">, number>>>> = {
  "2-2": { DEF: 2, MID: 2, ATT: 0 },
  "1-2-1": { DEF: 1, MID: 2, ATT: 1 },
  "1-1-2": { DEF: 1, MID: 1, ATT: 2 },
  "2-1-1": { DEF: 2, MID: 1, ATT: 1 },
};

export function createLegendsDraft(users: readonly [string, string], pool: readonly DraftPoolPlayer[]): LegendsDraftState {
  if (!users[0] || !users[1] || users[0] === users[1]) throw new Error("DRAFT_USERS_MUST_DIFFER");
  if (pool.length < 10) throw new Error("DRAFT_POOL_REQUIRES_TEN_PLAYERS");
  const ids = new Set<string>();
  for (const player of pool) {
    if (!player.id || ids.has(player.id)) throw new Error("DRAFT_POOL_PLAYER_IDS_MUST_BE_UNIQUE");
    if (!player.name || !Number.isFinite(player.overall) || player.overall < 0) throw new Error("DRAFT_POOL_PLAYER_INVALID");
    ids.add(player.id);
  }
  return { users, pool: pool.map((player) => ({ ...player })), picks: [], status: "DRAFTING" };
}

/** Picks are serialized by the caller inside its transaction; this function is the domain guard. */
export function pickLegendsDraftPlayer(state: LegendsDraftState, userId: string, playerId: string): LegendsDraftState {
  if (state.status !== "DRAFTING") throw new Error("DRAFT_ALREADY_COMPLETE");
  if (state.picks.length >= 10) throw new Error("DRAFT_ALREADY_COMPLETE");
  const expectedUser = state.users[state.picks.length % 2];
  if (userId !== expectedUser) throw new Error("DRAFT_NOT_YOUR_TURN");
  if (state.picks.some((pick) => pick.player.id === playerId)) throw new Error("DRAFT_PLAYER_ALREADY_PICKED");
  const player = state.pool.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("DRAFT_PLAYER_NOT_IN_POOL");
  const ownPicks = state.picks.filter((pick) => pick.userId === userId);
  const ownKeepers = ownPicks.filter((pick) => pick.player.line === "GK").length;
  const ownOutfield = ownPicks.length - ownKeepers;
  const picksRemaining = 5 - ownPicks.length;
  if (player.line === "GK" && ownKeepers > 0) throw new Error("DRAFT_TEAM_ALREADY_HAS_GOALKEEPER");
  if (player.line !== "GK" && ownOutfield >= 4) throw new Error("DRAFT_TEAM_ALREADY_HAS_FOUR_OUTFIELD_PLAYERS");
  if (picksRemaining === 1 && ((ownKeepers === 0 && player.line !== "GK") || (ownOutfield < 4 && player.line === "GK"))) {
    throw new Error("DRAFT_PICK_MUST_COMPLETE_TEAM_ROSTER");
  }
  const picks = [...state.picks, { pickNumber: state.picks.length + 1, userId, player: { ...player } }];
  return { ...state, picks, status: picks.length === 10 ? "COMPLETE" : "DRAFTING" };
}

export interface DraftLineup {
  goalkeeper: DraftPoolPlayer;
  formation: DraftFormation;
  lines: Readonly<Record<Exclude<DraftLine, "GK">, readonly DraftPoolPlayer[]>>;
}

/** Keeps all four outfield players; overflow moves to the nearest line with a vacancy. */
export function arrangeLegendsDraftLineup(
  players: readonly DraftPoolPlayer[],
  formation: DraftFormation,
): DraftLineup {
  if (players.length !== 5) throw new Error("DRAFT_LINEUP_REQUIRES_FIVE_PLAYERS");
  const ids = new Set(players.map((player) => player.id));
  if (ids.size !== players.length) throw new Error("DRAFT_LINEUP_PLAYERS_MUST_BE_UNIQUE");
  const keepers = players.filter((player) => player.line === "GK");
  if (keepers.length !== 1) throw new Error("DRAFT_LINEUP_REQUIRES_ONE_GOALKEEPER");

  const order = ["DEF", "MID", "ATT"] as const;
  const capacities = LEGENDS_DRAFT_FORMATIONS[formation];
  const lines: Record<Exclude<DraftLine, "GK">, DraftPoolPlayer[]> = { DEF: [], MID: [], ATT: [] };
  for (const player of players.filter((item) => item.line !== "GK")) lines[player.line].push(player);

  const distance = (from: typeof order[number], to: typeof order[number]) => Math.abs(order.indexOf(from) - order.indexOf(to));
  while (order.some((line) => lines[line].length > capacities[line])) {
    const source = order.find((line) => lines[line].length > capacities[line]);
    if (!source) break;
    const destination = order
      .filter((line) => lines[line].length < capacities[line])
      .sort((a, b) => distance(source, a) - distance(source, b)
        || (a === "MID" ? -1 : b === "MID" ? 1 : order.indexOf(a) - order.indexOf(b)))[0];
    if (!destination) throw new Error("DRAFT_FORMATION_CAPACITY_INVALID");
    lines[destination].push(lines[source].pop()!);
  }

  return { goalkeeper: keepers[0]!, formation, lines };
}
