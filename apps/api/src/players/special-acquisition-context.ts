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

export interface SpecialAcquisitionPort {
  acquire(input: SpecialAcquisitionCommand): Promise<SpecialAcquisitionResult>;
}


const specialAcquisitionScope = new AsyncLocalStorage<SpecialAcquisitionPort>();

export function withSpecialAcquisitionPort<T>(port: SpecialAcquisitionPort, operation: () => T): T {
  return specialAcquisitionScope.run(port, operation);
}

export function getSpecialAcquisitionPort(): SpecialAcquisitionPort | undefined {
  return specialAcquisitionScope.getStore();
}
