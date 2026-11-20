import { getSpecialAcquisitionPort, type SpecialPackMethod } from "./special-acquisition-context.js";
export type { SpecialPackMethod } from "./special-acquisition-context.js";

const PACKS: Record<SpecialPackMethod, { rarity: string; price: number; maxCopies: number }> = {
  epic_pack: { rarity: "EPIC", price: 250, maxCopies: 10 },
  legendary_pack: { rarity: "LEGENDARY", price: 2_500, maxCopies: 3 },
  icon_pack: { rarity: "ICON", price: 25_000, maxCopies: 1 },
};

export class SpecialAcquisitionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SpecialAcquisitionError";
  }
}

export class LegacyChallengeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "LegacyChallengeError";
  }
}

export function getSpecialPackOffers() {
  return Object.entries(PACKS).map(([method, pack]) => ({
    method,
    rarity: pack.rarity,
    priceGold: String(pack.price),
    maxCopiesPerPlayer: pack.maxCopies,
  }));
}

export async function acquireSpecialPlayer(userId: string, method: SpecialPackMethod, idempotencyKey: string) {
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(idempotencyKey)) throw new SpecialAcquisitionError("INVALID_IDEMPOTENCY_KEY");
  if (!Object.prototype.hasOwnProperty.call(PACKS, method)) throw new SpecialAcquisitionError("INVALID_ACQUISITION_METHOD");
  const port = getSpecialAcquisitionPort();
  if (!port) throw new SpecialAcquisitionError("SUPABASE_SPECIAL_ACQUISITION_UNAVAILABLE");
  try {
    return await port.acquire({ userId, method, idempotencyKey });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code) : error instanceof Error ? error.message : "";
    if (code) throw new SpecialAcquisitionError(code);
    throw error;
  }
}

export async function listLegacyChallenges(userId: string) {
  const port = getSpecialAcquisitionPort();
  if (!port) throw new LegacyChallengeError("SUPABASE_LEGACY_CHALLENGES_UNAVAILABLE");
  try { return await port.listLegacyChallenges(userId); }
  catch (error) { throw new LegacyChallengeError(error instanceof Error ? error.message : "LEGACY_CHALLENGES_UNAVAILABLE"); }
}

export async function claimLegacyChallenge(userId: string, slug: string) {
  const port = getSpecialAcquisitionPort();
  if (!port) throw new LegacyChallengeError("SUPABASE_LEGACY_CHALLENGE_CLAIM_UNAVAILABLE");
  try { return await port.claimLegacyChallenge(userId, slug); }
  catch (error) { throw new LegacyChallengeError(error instanceof Error ? error.message : "LEGACY_CHALLENGE_CLAIM_FAILED"); }
}
