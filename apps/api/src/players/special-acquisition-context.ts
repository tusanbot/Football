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

export interface SpecialAcquisitionPort {
  acquire(input: SpecialAcquisitionCommand): Promise<SpecialAcquisitionResult>;
}
