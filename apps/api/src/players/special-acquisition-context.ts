import { AsyncLocalStorage } from "node:async_hooks";

export type SpecialPackMethod = "epic_pack" | "legendary_pack" | "icon_pack";

export interface SpecialAcquisitionCommand {
  userId: string;
  method: SpecialPackMethod;
  idempotencyKey: string;
}

export interface SpecialAcquisitionResult {
  acquisitionId: string;
  method: SpecialPackMethod;
  playerId: string;
  specialPlayer: { id: string; fullName: string; rarity: string; overall: number };
  goldBalance: string;
  replayed: boolean;
}

export interface LegacyChallengeView {
  slug: string; title: string; description: string; rewardName: string;
  progress: { matches: number; wins: number; goals: number; requiredMatches: number; requiredWins: number; requiredGoals: number; completed: boolean };
  claimed: boolean; available: boolean; canClaim: boolean;
}
export interface LegacyChallengeClaimResult {
  acquisitionId: string; playerId: string;
  specialPlayer: { id: string; fullName: string; rarity: string; overall: number };
  replayed: boolean;
}
export interface SpecialAcquisitionPort {
  listActive?(): Promise<unknown[]>;
  acquire(input: SpecialAcquisitionCommand): Promise<SpecialAcquisitionResult>;
  listLegacyChallenges(userId: string): Promise<{ challenges: LegacyChallengeView[] }>;
  claimLegacyChallenge(userId: string, slug: string): Promise<LegacyChallengeClaimResult>;
}


const specialAcquisitionScope = new AsyncLocalStorage<SpecialAcquisitionPort>();

export function withSpecialAcquisitionPort<T>(port: SpecialAcquisitionPort, operation: () => T): T {
  return specialAcquisitionScope.run(port, operation);
}

export function getSpecialAcquisitionPort(): SpecialAcquisitionPort | undefined {
  return specialAcquisitionScope.getStore();
}
