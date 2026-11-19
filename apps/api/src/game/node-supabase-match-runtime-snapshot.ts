import type { MatchRuntimeSnapshotPort } from "./match-runtime-snapshot-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function dateValue(value: unknown, field: string): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("SUPABASE_MATCH_RUNTIME_SNAPSHOT_INVALID_" + field.toUpperCase());
  }
  return new Date(value);
}
function normalizeClub(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value.players) || !isRecord(value.owner)) {
    throw new Error("SUPABASE_MATCH_RUNTIME_SNAPSHOT_INVALID_CLUB");
  }
  const coach = value.coach;
  return {
    ...value,
    ticketPrice: BigInt(String(value.ticketPrice)),
    owner: value.owner,
    coach: coach === null ? null : coach,
    players: value.players.map((player) => {
      if (!isRecord(player)) throw new Error("SUPABASE_MATCH_RUNTIME_SNAPSHOT_INVALID_PLAYER");
      return { ...player, injuryUntil: dateValue(player.injuryUntil, "player_injury_until") };
    }),
  };
}
export class SupabaseMatchRuntimeSnapshotRepository implements MatchRuntimeSnapshotPort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async get(runtimeId: string): Promise<unknown | null> {
    const result = await this.client.rpc<unknown>("get_match_runtime_snapshot_http", {
      p_runtime_id: runtimeId,
    });
    if (result === null) return null;
    if (!isRecord(result) || !isRecord(result.match) || !isRecord(result.match.homeClub)
      || !isRecord(result.match.awayClub) || typeof result.id !== "string"
      || typeof result.matchId !== "string" || typeof result.stateVersion !== "number"
      || typeof result.currentMinute !== "number" || typeof result.status !== "string"
      || typeof result.match.id !== "string" || typeof result.match.seed !== "string"
      || typeof result.match.status !== "string") {
      throw new Error("SUPABASE_MATCH_RUNTIME_SNAPSHOT_INVALID_RESPONSE");
    }
    const match = result.match;
    return {
      ...result,
      nextActionAt: dateValue(result.nextActionAt, "next_action_at"),
      startedAt: dateValue(result.startedAt, "runtime_started_at"),
      completedAt: dateValue(result.completedAt, "runtime_completed_at"),
      leaseExpiresAt: dateValue(result.leaseExpiresAt, "lease_expires_at"),
      match: {
        ...match,
        scheduledAt: dateValue(match.scheduledAt, "scheduled_at"),
        startedAt: dateValue(match.startedAt, "match_started_at"),
        completedAt: dateValue(match.completedAt, "match_completed_at"),
        homeClub: normalizeClub(match.homeClub),
        awayClub: normalizeClub(match.awayClub),
      },
    };
  }
}
