export const FACILITY_TYPES = ["STADIUM", "TRAINING_GROUND", "ACADEMY"] as const;
export type FacilityType = typeof FACILITY_TYPES[number];

export const MAX_FACILITY_LEVEL = 10;

export function calculateFacilityUpgradeCost(facility: FacilityType, currentLevel: number): bigint {
  if (!Number.isInteger(currentLevel) || currentLevel < 0 || currentLevel >= MAX_FACILITY_LEVEL) {
    throw new Error("Facility level is outside the upgrade range.");
  }
  const nextLevel = currentLevel + 1;
  const base = facility === "STADIUM" ? 4_000 : facility === "TRAINING_GROUND" ? 2_500 : 3_500;
  const levelFactor = facility === "ACADEMY" ? Math.max(1, currentLevel) : currentLevel;
  return BigInt(base * levelFactor * levelFactor);
}

export function calculateStadiumCapacity(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > MAX_FACILITY_LEVEL) {
    throw new Error("Stadium level must be between 1 and 10.");
  }
  return Math.round((1_000 * Math.pow(1.4, level - 1)) / 100) * 100;
}

export function calculateDailyOperatingCost(input: {
  stadiumLevel: number;
  trainingGroundLevel: number;
  academyLevel: number;
}): bigint {
  for (const level of [input.stadiumLevel, input.trainingGroundLevel]) {
    if (!Number.isInteger(level) || level < 1 || level > MAX_FACILITY_LEVEL) throw new Error("Facility level is invalid.");
  }
  if (!Number.isInteger(input.academyLevel) || input.academyLevel < 0 || input.academyLevel > MAX_FACILITY_LEVEL) {
    throw new Error("Academy level is invalid.");
  }
  return BigInt(input.stadiumLevel * 20 + input.trainingGroundLevel * 15 + input.academyLevel * 10);
}

export function calculateAcademyScoutCost(academyLevel: number): bigint {
  if (!Number.isInteger(academyLevel) || academyLevel < 1 || academyLevel > MAX_FACILITY_LEVEL) {
    throw new Error("Academy must be upgraded before scouting.");
  }
  return BigInt(1_000 + academyLevel * 750);
}

export function calculateProspectRecruitmentCost(overall: number, potential: number, academyLevel: number): bigint {
  if (![overall, potential, academyLevel].every(Number.isInteger)
    || overall < 20 || overall > 75 || potential < overall || potential > 99
    || academyLevel < 1 || academyLevel > MAX_FACILITY_LEVEL) {
    throw new Error("Prospect attributes are invalid.");
  }
  return BigInt(overall * 45 + potential * 25 + academyLevel * 100);
}

export interface SponsorOffer {
  id: string;
  partnerName: string;
  tier: "BRONZE" | "SILVER" | "GOLD";
  minimumLevel: number;
  minimumReputation: number;
  dailyIncome: bigint;
  signingBonus: bigint;
  durationDays: number;
}

export function getSponsorOffers(level: number, reputation: number): SponsorOffer[] {
  const offers: SponsorOffer[] = [
    { id: "local-partner", partnerName: "Local Sports Partner", tier: "BRONZE", minimumLevel: 1, minimumReputation: 0, dailyIncome: 250n, signingBonus: 500n, durationDays: 30 },
    { id: "regional-brand", partnerName: "Regional Sports Brand", tier: "SILVER", minimumLevel: 2, minimumReputation: 50, dailyIncome: 400n, signingBonus: 1_500n, durationDays: 45 },
    { id: "national-network", partnerName: "National Sports Network", tier: "GOLD", minimumLevel: 3, minimumReputation: 150, dailyIncome: 650n, signingBonus: 3_500n, durationDays: 60 },
  ];
  return offers.filter((offer) => level >= offer.minimumLevel && reputation >= offer.minimumReputation);
}

export const COACH_CANDIDATES = [
  { id: "balanced", name: "Balanced Coach", signingFee: 1_000n, weeklySalary: 130n, trainingSkill: 45, recoverySkill: 45, medicalSkill: 40 },
  { id: "youth", name: "Youth Development Coach", signingFee: 1_800n, weeklySalary: 170n, trainingSkill: 65, recoverySkill: 40, medicalSkill: 35 },
  { id: "performance", name: "Performance Coach", signingFee: 2_000n, weeklySalary: 190n, trainingSkill: 45, recoverySkill: 65, medicalSkill: 60 },
] as const;

export function calculateCoachUpgradeCost(level: number): bigint {
  if (!Number.isInteger(level) || level < 1 || level >= MAX_FACILITY_LEVEL) {
    throw new Error("Coach level is outside the upgrade range.");
  }
  return BigInt(1_500 * level * level);
}

/** Calculates gross gate receipts for a completed fixture; attendance is server-simulated. */
export function calculateMatchdayTicketRevenue(
  stadiumCapacity: number,
  ticketPrice: bigint,
  attendanceBasisPoints: number,
): bigint {
  if (!Number.isInteger(stadiumCapacity) || stadiumCapacity < 0
    || ticketPrice < 0n || !Number.isInteger(attendanceBasisPoints)
    || attendanceBasisPoints < 0 || attendanceBasisPoints > 10_000) {
    throw new Error("Matchday ticket inputs are invalid.");
  }
  const attendees = Math.floor(stadiumCapacity * attendanceBasisPoints / 10_000);
  return BigInt(attendees) * ticketPrice;
}
