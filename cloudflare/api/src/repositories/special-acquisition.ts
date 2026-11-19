import type { SpecialAcquisitionCommand, SpecialAcquisitionPort, SpecialAcquisitionResult } from "../../../../apps/api/src/players/special-acquisition-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../supabase-http.js";

interface SpecialAcquisitionRpcRow {
  acquisition_id: string;
  player_id: string;
  method: string;
  special_player: { id: string; fullName: string; rarity: string; overall: number };
  gold_balance: string;
  replayed: boolean;
}

const SPECIAL_ACQUISITION_ERRORS = new Set([
  "INVALID_IDEMPOTENCY_KEY",
  "INVALID_ACQUISITION_METHOD",
  "IDEMPOTENCY_CONFLICT",
  "CLUB_NOT_FOUND",
  "NO_AVAILABLE_PLAYERS",
  "WALLET_NOT_FOUND",
  "INSUFFICIENT_GOLD",
  "CONCURRENT_MODIFICATION",
]);

export class SupabaseSpecialAcquisitionRepository implements SpecialAcquisitionPort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async listLegacyChallenges(userId: string) {
    const rows = await this.client.rpc<Array<{ challenges: unknown }>>("list_legacy_special_challenges", { p_user_id: userId });
    const value = Array.isArray(rows) ? rows[0]?.challenges : undefined;
    if (!Array.isArray(value)) throw new Error("SUPABASE_LEGACY_CHALLENGES_INVALID_RESPONSE");
    return { challenges: value as import("../../../../apps/api/src/players/special-acquisition-context.js").LegacyChallengeView[] };
  }

  async claimLegacyChallenge(userId: string, slug: string) {
    const rows = await this.client.rpc<Array<{ result: unknown }>>("claim_legacy_special_challenge", { p_user_id: userId, p_slug: slug });
    const row = Array.isArray(rows) ? rows[0]?.result : undefined;
    if (!row || typeof row !== "object") throw new Error("SUPABASE_LEGACY_CHALLENGE_CLAIM_INVALID_RESPONSE");
    return row as import("../../../../apps/api/src/players/special-acquisition-context.js").LegacyChallengeClaimResult;
  }

  async acquire(input: SpecialAcquisitionCommand): Promise<SpecialAcquisitionResult> {
    let rows: SpecialAcquisitionRpcRow[];
    try {
      rows = await this.client.rpc<SpecialAcquisitionRpcRow[]>("acquire_special_player", {
        p_user_id: input.userId,
        p_method: input.method,
        p_idempotency_key: input.idempotencyKey,
      });
    } catch (error) {
      const message = error instanceof SupabaseHttpError ? error.message : error instanceof Error ? error.message : "";
      const code = message.toLowerCase().includes("duplicate key") || message.toLowerCase().includes("unique constraint")
        ? "IDEMPOTENCY_CONFLICT"
        : [...SPECIAL_ACQUISITION_ERRORS].find((candidate) => message.includes(candidate));
      if (code) throw new Error(code);
      throw error;
    }

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row || typeof row.acquisition_id !== "string" || typeof row.player_id !== "string"
      || row.method !== input.method || !row.special_player || typeof row.special_player.id !== "string"
      || typeof row.special_player.fullName !== "string" || typeof row.special_player.rarity !== "string"
      || !Number.isInteger(row.special_player.overall) || typeof row.gold_balance !== "string"
      || !/^-?\d+$/.test(row.gold_balance) || typeof row.replayed !== "boolean") {
      throw new Error("SUPABASE_SPECIAL_ACQUISITION_INVALID_RESPONSE");
    }
    return {
      acquisitionId: row.acquisition_id,
      method: input.method,
      playerId: row.player_id,
      specialPlayer: row.special_player,
      goldBalance: row.gold_balance,
      replayed: row.replayed,
    };
  }
}
