import type { PlayerAttributes, PlayerPosition } from "./players.js";

export const TRAINING_FOCUSES = [
  "BALANCED", "GOALKEEPING", "DEFENDING", "PASSING",
  "PLAYMAKING", "DRIBBLING", "SHOOTING", "PHYSICAL",
] as const;
export type TrainingFocus = typeof TRAINING_FOCUSES[number];

export const TRAINING_INTENSITIES = ["LIGHT", "NORMAL", "INTENSE"] as const;
export type TrainingIntensity = typeof TRAINING_INTENSITIES[number];

export interface DevelopmentPlayer {
  age: number;
  position: PlayerPosition;
  overall: number;
  potential: number;
  attributes: PlayerAttributes;
  fitness: number;
  morale: number;
}

export interface TrainingResult {
  attributes: PlayerAttributes;
  overall: number;
  fitness: number;
  morale: number;
  attributeGain: number;
  fitnessCost: number;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const focusAttributes: Record<Exclude<TrainingFocus, "BALANCED">, (keyof PlayerAttributes)[]> = {
  GOALKEEPING: ["goalkeeping"],
  DEFENDING: ["defending"],
  PASSING: ["passing"],
  PLAYMAKING: ["passing", "dribbling"],
  DRIBBLING: ["dribbling"],
  SHOOTING: ["shooting"],
  PHYSICAL: ["physical", "pace"],
};

const overallWeights: Record<PlayerPosition, Partial<Record<keyof PlayerAttributes, number>>> = {
  GK: { goalkeeping: 0.65, defending: 0.1, physical: 0.1, passing: 0.08, pace: 0.04, dribbling: 0.02, shooting: 0.01 },
  CB: { defending: 0.34, physical: 0.25, pace: 0.12, passing: 0.12, dribbling: 0.08, shooting: 0.05, goalkeeping: 0.04 },
  RB: { defending: 0.24, pace: 0.2, physical: 0.16, passing: 0.15, dribbling: 0.14, shooting: 0.07, goalkeeping: 0.04 },
  LB: { defending: 0.24, pace: 0.2, physical: 0.16, passing: 0.15, dribbling: 0.14, shooting: 0.07, goalkeeping: 0.04 },
  CDM: { defending: 0.25, passing: 0.22, physical: 0.18, dribbling: 0.12, pace: 0.1, shooting: 0.09, goalkeeping: 0.04 },
  CM: { passing: 0.25, dribbling: 0.2, physical: 0.15, defending: 0.14, shooting: 0.12, pace: 0.1, goalkeeping: 0.04 },
  CAM: { passing: 0.24, dribbling: 0.22, shooting: 0.2, pace: 0.13, physical: 0.08, defending: 0.09, goalkeeping: 0.04 },
  RW: { pace: 0.22, dribbling: 0.22, shooting: 0.2, passing: 0.16, physical: 0.1, defending: 0.06, goalkeeping: 0.04 },
  LW: { pace: 0.22, dribbling: 0.22, shooting: 0.2, passing: 0.16, physical: 0.1, defending: 0.06, goalkeeping: 0.04 },
  ST: { shooting: 0.3, physical: 0.18, pace: 0.17, dribbling: 0.14, passing: 0.1, defending: 0.05, goalkeeping: 0.04 },
};

export function calculatePlayerOverall(position: PlayerPosition, attributes: PlayerAttributes): number {
  const weights = overallWeights[position];
  const score = (Object.entries(weights) as [keyof PlayerAttributes, number][])
    .reduce((total, [attribute, weight]) => total + attributes[attribute] * weight, 0);
  return clamp(Math.round(score), 20, 99);
}

/** Pure deterministic training calculation. randomRoll must be an integer from 0 through 9999. */
export function calculateTrainingResult(
  player: DevelopmentPlayer,
  focus: TrainingFocus,
  intensity: TrainingIntensity,
  coachTrainingSkill: number,
  facilityLevel: number,
  randomRoll = 5000,
): TrainingResult {
  if (!Number.isInteger(randomRoll) || randomRoll < 0 || randomRoll > 9999) {
    throw new Error("Training random roll must be an integer from 0 to 9999.");
  }
  const intensityBase = intensity === "LIGHT" ? 1 : intensity === "NORMAL" ? 2 : 3;
  const ageFactor = player.age < 21 ? 1.25 : player.age <= 25 ? 1.1 : player.age <= 29 ? 0.85 : player.age <= 32 ? 0.6 : 0.35;
  const potentialGap = Math.max(0, player.potential - player.overall);
  const potentialFactor = potentialGap === 0 ? 0.25 : 0.55 + Math.min(0.45, potentialGap / 30);
  const coachFactor = 0.8 + clamp(coachTrainingSkill, 0, 100) / 200;
  const facilityFactor = 1 + (clamp(facilityLevel, 1, 10) - 1) * 0.04;
  const rollFactor = 0.85 + randomRoll / 33300;
  const rawGain = intensityBase * ageFactor * potentialFactor * coachFactor * facilityFactor * rollFactor;
  const gain = Math.max(0, Math.min(3, Math.floor(rawGain)));
  const attributes = { ...player.attributes };
  const targets = focus === "BALANCED"
    ? (["pace", "passing", "physical"] as const)
    : focusAttributes[focus];
  const perAttribute = focus === "BALANCED" ? (gain > 0 ? 1 : 0) : gain;
  for (const attribute of targets) {
    attributes[attribute] = clamp(attributes[attribute] + perAttribute, 20, 99);
  }
  let overall = calculatePlayerOverall(player.position, attributes);
  overall = Math.min(player.potential, Math.max(player.overall, overall));

  const fitnessCost = intensity === "LIGHT" ? 2 : intensity === "NORMAL" ? 5 : 10;
  const fitness = clamp(player.fitness - fitnessCost, 0, 100);
  const morale = clamp(player.morale + (gain > 0 ? 1 : 0) - (intensity === "INTENSE" && player.fitness < 45 ? 2 : 0));
  return { attributes, overall, fitness, morale, attributeGain: gain, fitnessCost };
}

export function calculateInjuryChanceBasisPoints(
  fitness: number,
  intensity: TrainingIntensity,
  coachMedicalSkill: number,
): number {
  const base = intensity === "LIGHT" ? 5 : intensity === "NORMAL" ? 20 : 90;
  const fatigueRisk = Math.max(0, 70 - clamp(fitness, 0, 100)) * (intensity === "INTENSE" ? 5 : 2);
  const medicalMitigation = clamp(coachMedicalSkill, 0, 100) * 0.35;
  return Math.max(0, Math.min(1500, Math.round(base + fatigueRisk - medicalMitigation)));
}

export interface DailyPlayerState {
  contractDays: number;
  fitness: number;
  morale: number;
  status: "ACTIVE" | "LISTED" | "INJURED" | "RETIRED" | "CONTRACT_EXPIRED";
  injuryUntil: Date | null;
}

export function advancePlayerDailyState(
  player: DailyPlayerState,
  elapsedDays: number,
  now: Date,
  recoverySkill: number,
): DailyPlayerState {
  if (!Number.isInteger(elapsedDays) || elapsedDays < 0) throw new Error("Elapsed days must be a non-negative integer.");
  if (elapsedDays === 0 || player.status === "RETIRED") return player;
  const contractDays = Math.max(0, player.contractDays - elapsedDays);
  if (player.status === "LISTED") {
    return {
      ...player,
      contractDays,
      fitness: clamp(player.fitness + elapsedDays * Math.max(4, Math.min(12, 5 + Math.floor(clamp(recoverySkill, 0, 100) / 20)))),
      status: contractDays === 0 ? "CONTRACT_EXPIRED" : "LISTED",
    };
  }
  const recoveryPerDay = Math.max(4, Math.min(12, 5 + Math.floor(clamp(recoverySkill, 0, 100) / 20)));
  let fitness = clamp(player.fitness + elapsedDays * recoveryPerDay);
  let status = player.status;
  const injuryRecovered = player.injuryUntil !== null && player.injuryUntil <= now;
  if (status === "INJURED" && injuryRecovered) {
    status = "ACTIVE";
    fitness = Math.max(55, fitness);
  }
  if (contractDays === 0 && status !== "RETIRED") status = "CONTRACT_EXPIRED";
  else if (status === "CONTRACT_EXPIRED" && contractDays > 0) status = player.injuryUntil && player.injuryUntil > now ? "INJURED" : "ACTIVE";
  const moraleDelta = status === "INJURED" ? -Math.min(10, elapsedDays * 2)
    : status === "CONTRACT_EXPIRED" ? -Math.min(12, elapsedDays)
    : fitness >= 75 ? Math.min(5, elapsedDays) : 0;
  return {
    contractDays,
    fitness,
    morale: clamp(player.morale + moraleDelta),
    status,
    injuryUntil: injuryRecovered ? null : player.injuryUntil,
  };
}

export interface ContractDemandInput {
  age: number;
  overall: number;
  potential: number;
  morale: number;
  currentWeeklyWage: bigint;
}

export function calculateContractDemand(player: ContractDemandInput) {
  const baseline = BigInt(Math.max(
    50,
    player.overall * 2 + Math.max(0, player.potential - player.overall) * 3 + (player.age < 21 ? 20 : 0),
  ));
  const current = player.currentWeeklyWage > baseline ? player.currentWeeklyWage : baseline;
  const moralePremium = player.morale >= 85 ? 15n : player.morale >= 70 ? 8n : 0n;
  const minimumWeeklyWage = (current * (100n + moralePremium) + 99n) / 100n;
  const maximumWeeklyWage = minimumWeeklyWage * 2n;
  return { minimumWeeklyWage, maximumWeeklyWage };
}
