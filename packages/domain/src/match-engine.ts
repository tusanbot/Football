import type { PlayerAttributes, PlayerPosition } from "./players.js";

export type MatchTactics = {
  mentality: "DEFENSIVE" | "BALANCED" | "ATTACKING";
  pressing: "LOW_BLOCK" | "MID_BLOCK" | "HIGH_PRESS";
  tempo: "SLOW" | "NORMAL" | "FAST";
  passingStyle: "SHORT" | "MIXED" | "DIRECT";
};
export type MatchPlayer = {
  id: string; name: string; position: PlayerPosition; overall: number;
  morale: number; fitness: number; attributes: PlayerAttributes;
};
export type MatchSide = {
  clubId: string; clubName: string; formation: string; tactics: MatchTactics;
  players: MatchPlayer[]; bench?: MatchPlayer[]; stadiumCapacity: number; ticketPrice: bigint; reputation: number; coachMedicalSkill: number;
};
export type MatchEventType = "GOAL" | "YELLOW_CARD" | "RED_CARD" | "INJURY" | "SUBSTITUTION";
export type MatchEvent = {
  sequence: number; minute: number; type: MatchEventType; teamId: string;
  playerId: string; relatedPlayerId?: string; detail: string;
};
export type PlayerMatchLine = {
  playerId: string; clubId: string; minutesPlayed: number; goals: number; assists: number;
  shots: number; passes: number; tackles: number; yellowCards: number; redCards: number;
  rating: number; fitnessLoss: number;
};
export type MatchSimulation = {
  homeScore: number; awayScore: number; attendance: number; ticketRevenue: bigint;
  events: MatchEvent[]; performances: PlayerMatchLine[];
  homeExpectedGoals: number; awayExpectedGoals: number;
};

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function random(seed: number) {
  let state = seed || 0x9e3779b9;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number) => Math.round(value * 100) / 100;

function sideStrength(side: MatchSide) {
  if (side.players.length !== 11) throw new Error("MATCH_REQUIRES_ELEVEN_PLAYERS");
  const average = side.players.reduce((sum, player) =>
    sum + player.overall * (0.72 + player.fitness / 250 + player.morale / 500), 0) / 11;
  const attack = side.players.reduce((sum, player) =>
    sum + (player.attributes.shooting * 0.45 + player.attributes.pace * 0.2 + player.attributes.dribbling * 0.2 + player.attributes.passing * 0.15)
      * (player.position === "ST" || player.position === "RW" || player.position === "LW" ? 1.25 : 0.82), 0) / 11;
  const defense = side.players.reduce((sum, player) =>
    sum + (player.attributes.defending * 0.55 + player.attributes.physical * 0.25 + player.attributes.pace * 0.2)
      * (["CB", "LB", "RB", "CDM", "GK"].includes(player.position) ? 1.22 : 0.8), 0) / 11;
  const tactics = (side.tactics.mentality === "ATTACKING" ? 1.08 : side.tactics.mentality === "DEFENSIVE" ? 0.94 : 1)
    * (side.tactics.pressing === "HIGH_PRESS" ? 1.025 : side.tactics.pressing === "LOW_BLOCK" ? 0.985 : 1)
    * (side.tactics.tempo === "FAST" ? 1.025 : side.tactics.tempo === "SLOW" ? 0.985 : 1);
  return { average, attack: attack * tactics, defense: defense * (side.tactics.mentality === "DEFENSIVE" ? 1.08 : 1) };
}
function choose<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}
function weightedPlayer(players: MatchPlayer[], weight: (player: MatchPlayer) => number, rng: () => number) {
  const weights = players.map((player) => Math.max(1, weight(player)));
  const total = weights.reduce((sum, item) => sum + item, 0);
  let cursor = rng() * total;
  for (let i = 0; i < players.length; i++) {
    cursor -= weights[i]!;
    if (cursor <= 0) return players[i]!;
  }
  return players[players.length - 1]!;
}

/** Deterministic, reproducible 90-minute match simulation. Persist the seed with the fixture. */
export function simulateFootballMatch(input: {
  seed: string; home: MatchSide; away: MatchSide;
}): MatchSimulation {
  if (input.home.clubId === input.away.clubId) throw new Error("MATCH_TEAMS_MUST_DIFFER");
  const rng = random(hashSeed(input.seed));
  const homeStrength = sideStrength(input.home);
  const awayStrength = sideStrength(input.away);
  const homeXg = clamp(1.25 + (homeStrength.attack - awayStrength.defense) / 48 + (homeStrength.average - awayStrength.average) / 95 + 0.18, 0.25, 3.8);
  const awayXg = clamp(1.12 + (awayStrength.attack - homeStrength.defense) / 48 + (awayStrength.average - homeStrength.average) / 95, 0.2, 3.5);
  const homeShots = clamp(Math.round(8 + homeXg * 4 + rng() * 7), 5, 28);
  const awayShots = clamp(Math.round(8 + awayXg * 4 + rng() * 7), 5, 28);
  const events: MatchEvent[] = [];
  const performances = new Map<string, PlayerMatchLine>();
  for (const side of [input.home, input.away]) {
    for (const player of side.players) performances.set(player.id, {
      playerId: player.id, clubId: side.clubId, minutesPlayed: 90, goals: 0, assists: 0,
      shots: 0, passes: 0, tackles: 0, yellowCards: 0, redCards: 0, rating: 6, fitnessLoss: 0,
    });
    for (const player of side.bench ?? []) performances.set(player.id, {
      playerId: player.id, clubId: side.clubId, minutesPlayed: 0, goals: 0, assists: 0,
      shots: 0, passes: 0, tackles: 0, yellowCards: 0, redCards: 0, rating: 6, fitnessLoss: 0,
    });
  }
  const addEvent = (event: Omit<MatchEvent, "sequence">) => events.push({ ...event, sequence: events.length + 1 });
  let homeScore = 0, awayScore = 0;
  const simulateSide = (side: MatchSide, opponent: MatchSide, xg: number, shots: number, isHome: boolean) => {
    const target = Math.max(0, Math.round(xg + (rng() + rng() + rng() - 1.5) * 0.9));
    const attackers = side.players.filter((p) => ["ST", "RW", "LW", "CAM", "CM"].includes(p.position));
    const scorers = attackers.length ? attackers : side.players;
    const defenders = side.players.filter((p) => ["CB", "LB", "RB", "CDM", "CM"].includes(p.position));
    const eventMinutes = new Set<number>();
    for (let i = 0; i < target; i++) {
      let minute = 1 + Math.floor(rng() * 90);
      while (eventMinutes.has(minute)) minute = minute % 90 + 1;
      eventMinutes.add(minute);
      const scorer = weightedPlayer(scorers, (p) => p.attributes.shooting + p.overall * 0.3, rng);
      const helpers = side.players.filter((p) => p.id !== scorer.id);
      const assister = rng() < 0.78 ? weightedPlayer(helpers, (p) => p.attributes.passing + p.overall * 0.2, rng) : null;
      const keeper = opponent.players.find((p) => p.position === "GK");
      addEvent({ minute, type: "GOAL", teamId: side.clubId, playerId: scorer.id, ...(assister ? { relatedPlayerId: assister.id } : {}), detail: assister ? "Goal scored; assist recorded." : "Goal scored." });
      const scorerLine = performances.get(scorer.id)!;
      scorerLine.goals++;
      scorerLine.shots++;
      scorerLine.rating += 1.05;
      if (assister) { performances.get(assister.id)!.assists++; performances.get(assister.id)!.rating += 0.55; }
      if (keeper) performances.get(keeper.id)!.rating -= 0.45;
      if (isHome) homeScore++; else awayScore++;
    }
    const allAttackers = side.players.filter((p) => ["ST", "RW", "LW", "CAM"].includes(p.position));
    for (let i = 0; i < shots; i++) {
      const player = weightedPlayer(allAttackers.length ? allAttackers : side.players, (p) => p.attributes.shooting + 10, rng);
      performances.get(player.id)!.shots++;
    }
    for (const player of side.players) {
      const line = performances.get(player.id)!;
      line.passes = Math.max(8, Math.round((player.attributes.passing * 0.65 + 12) * (side.tactics.passingStyle === "SHORT" ? 1.15 : side.tactics.passingStyle === "DIRECT" ? 0.82 : 1) * (0.8 + rng() * 0.4)));
      line.tackles = ["CB", "LB", "RB", "CDM", "CM"].includes(player.position) ? Math.round(player.attributes.defending / 14 * (0.5 + rng())) : Math.round(rng() * 2);
      line.fitnessLoss = Math.round((side.tactics.pressing === "HIGH_PRESS" ? 9 : 6) + rng() * 5);
      line.rating += clamp((line.passes / 30) * 0.12 + line.tackles * 0.08 - line.fitnessLoss * 0.025, -0.8, 0.6);
    }
    for (let i = 0; i < 2; i++) {
      if (rng() < 0.42) {
        const player = choose(side.players.filter((p) => p.position !== "GK"), rng);
        const minute = 5 + Math.floor(rng() * 84);
        const red = rng() < 0.035;
        addEvent({ minute, type: red ? "RED_CARD" : "YELLOW_CARD", teamId: side.clubId, playerId: player.id, detail: red ? "Sent off." : "Caution." });
        const line = performances.get(player.id)!;
        if (red) { line.redCards++; line.rating -= 1.25; } else { line.yellowCards++; line.rating -= 0.35; }
      }
    }
    const injuryChance = clamp(0.13 + (side.tactics.pressing === "HIGH_PRESS" ? 0.04 : side.tactics.pressing === "LOW_BLOCK" ? -0.02 : 0) - side.coachMedicalSkill * 0.0007, 0.03, 0.2);
    let injuredPlayer: MatchPlayer | null = null;
    let injuryMinute = 0;
    if (rng() < injuryChance) {
      injuredPlayer = choose(side.players.filter((p) => p.position !== "GK"), rng);
      injuryMinute = 8 + Math.floor(rng() * 80);
      addEvent({ minute: injuryMinute, type: "INJURY", teamId: side.clubId, playerId: injuredPlayer.id, detail: "Player suffered an in-match injury." });
      performances.get(injuredPlayer.id)!.rating -= 0.65;
    }

    const bench = [...(side.bench ?? [])];
    const usedBench = new Set<string>();
    const sentOff = new Set(events.filter((event) => event.teamId === side.clubId && event.type === "RED_CARD").map((event) => event.playerId));
    const substitutedOut = new Set<string>();
    const role = (position: PlayerPosition) => position === "GK" ? "GK"
      : ["CB", "LB", "RB"].includes(position) ? "DEF"
        : ["CDM", "CM", "CAM"].includes(position) ? "MID" : "ATT";
    const performSubstitution = (outgoing: MatchPlayer, minute: number) => {
      const incoming = bench
        .filter((candidate) => !usedBench.has(candidate.id) && role(candidate.position) === role(outgoing.position))
        .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))[0];
      if (!incoming) return false;
      usedBench.add(incoming.id);
      substitutedOut.add(outgoing.id);
      const outgoingLine = performances.get(outgoing.id)!;
      const incomingLine = performances.get(incoming.id)!;
      const playedFraction = clamp(minute / 90, 0.05, 1);
      const remainingFraction = 1 - playedFraction;
      outgoingLine.minutesPlayed = minute;
      outgoingLine.shots = Math.round(outgoingLine.shots * playedFraction);
      outgoingLine.passes = Math.round(outgoingLine.passes * playedFraction);
      outgoingLine.tackles = Math.round(outgoingLine.tackles * playedFraction);
      outgoingLine.fitnessLoss = Math.round(outgoingLine.fitnessLoss * playedFraction);
      incomingLine.minutesPlayed = 90 - minute;
      incomingLine.shots = Math.round((incoming.attributes.shooting / 16) * remainingFraction);
      incomingLine.passes = Math.max(1, Math.round((incoming.attributes.passing * 0.65 + 12) * remainingFraction));
      incomingLine.tackles = ["CB", "LB", "RB", "CDM", "CM"].includes(incoming.position)
        ? Math.round(incoming.attributes.defending / 14 * remainingFraction) : 0;
      incomingLine.fitnessLoss = Math.round((side.tactics.pressing === "HIGH_PRESS" ? 9 : 6) * remainingFraction);
      incomingLine.rating = clamp(6 + (incoming.overall - outgoing.overall) * 0.025, 4, 8);
      addEvent({
        minute, type: "SUBSTITUTION", teamId: side.clubId,
        playerId: outgoing.id, relatedPlayerId: incoming.id,
        detail: "Substitution: " + outgoing.name + " replaced by " + incoming.name + ".",
      });
      return true;
    };

    if (injuredPlayer) performSubstitution(injuredPlayer, Math.min(89, Math.max(8, injuryMinute)));
    const availableOutfield = side.players.filter((player) =>
      player.position !== "GK" && !sentOff.has(player.id) && !substitutedOut.has(player.id)
      && player.id !== injuredPlayer?.id,
    );
    const desiredSubstitutions = Math.min(5, 2 + Math.floor(rng() * 2));
    let additional = Math.max(0, desiredSubstitutions - (injuredPlayer && usedBench.size ? 1 : 0));
    while (additional > 0 && availableOutfield.length > 0) {
      const index = Math.floor(rng() * availableOutfield.length);
      const outgoing = availableOutfield.splice(index, 1)[0]!;
      const minute = 60 + Math.floor(rng() * 26);
      if (performSubstitution(outgoing, minute)) additional--;
    }
  };
  simulateSide(input.home, input.away, homeXg, homeShots, true);
  simulateSide(input.away, input.home, awayXg, awayShots, false);

  const capacity = Math.max(0, input.home.stadiumCapacity);
  const demand = 0.28 + input.home.reputation / 320 + homeStrength.average / 250
    + (input.home.tactics.mentality === "ATTACKING" ? 0.05 : 0);
  const priceFactor = clamp(1.18 - Number(input.home.ticketPrice) / 650, 0.28, 1.08);
  const attendance = Math.min(capacity, Math.max(0, Math.round(capacity * clamp(demand * priceFactor, 0.08, 0.98))));
  const ticketRevenue = BigInt(attendance) * input.home.ticketPrice;
  const chronologicalEvents = events.sort((a, b) => a.minute - b.minute || a.sequence - b.sequence)
    .map((event, index) => ({ ...event, sequence: index + 1 }));
  const performanceRows = [...performances.values()].map((line) => ({
    ...line,
    rating: round(clamp(line.rating + (line.goals ? 0.2 : 0) + (line.redCards ? 0 : 0.15), 3, 10)),
  }));
  return { homeScore, awayScore, attendance, ticketRevenue, events: chronologicalEvents, performances: performanceRows, homeExpectedGoals: round(homeXg), awayExpectedGoals: round(awayXg) };
}

/** Deterministic penalty shootout used to resolve knockout ties. */
export function simulatePenaltyShootout(input: { seed: string; home: MatchSide; away: MatchSide }) {
  const rng = random(hashSeed(input.seed + ":penalties"));
  const goalkeeper = (side: MatchSide) => side.players.find((player) => player.position === "GK")?.attributes.goalkeeping ?? 50;
  const shooters = (side: MatchSide) => side.players.filter((player) => player.position !== "GK");
  const scoringChance = (side: MatchSide, opponent: MatchSide) => {
    const list = shooters(side);
    const averageShooting = list.reduce((sum, player) => sum + player.attributes.shooting, 0) / Math.max(1, list.length);
    return clamp(0.74 + (averageShooting - goalkeeper(opponent)) / 700, 0.58, 0.88);
  };
  const homeChance = scoringChance(input.home, input.away);
  const awayChance = scoringChance(input.away, input.home);
  let homePenalties = 0, awayPenalties = 0;
  for (let kick = 0; kick < 5; kick++) {
    if (rng() < homeChance) homePenalties++;
    if (rng() < awayChance) awayPenalties++;
  }
  let suddenDeath = 0;
  while (homePenalties === awayPenalties && suddenDeath < 10) {
    if (rng() < homeChance) homePenalties++;
    if (rng() < awayChance) awayPenalties++;
    suddenDeath++;
  }
  if (homePenalties === awayPenalties) {
    if (rng() < 0.5) homePenalties++;
    else awayPenalties++;
  }
  return { homePenalties, awayPenalties, winner: homePenalties > awayPenalties ? "HOME" as const : "AWAY" as const };
}
