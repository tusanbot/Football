import type {
  MatchRuntimeLeaseClaimCommand, MatchRuntimeLease, MatchRuntimeLeasePort, MatchRuntimeLeaseReleaseCommand,
} from "../../../../apps/api/src/game/match-runtime-lease-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

interface ClaimRow { runtime_id: string; lease_token: string; lease_expires_at: string; }
interface ReleaseRow { released: boolean; }
interface ScheduleRow {
  next_alarm: string | null; has_due_runtime: boolean; has_due_fixture: boolean;
  has_due_notifications: boolean; has_pending_tournament_finalization: boolean; has_pending_promotion_work: boolean;
}
export interface MatchCoordinatorSchedule {
  nextAlarm: Date | null; hasDueRuntime: boolean; hasDueFixture: boolean; hasDueNotifications: boolean;
  hasPendingTournamentFinalization: boolean; hasPendingPromotionWork: boolean;
}

export class SupabaseMatchRuntimeLeaseRepository implements MatchRuntimeLeasePort {
  constructor(private readonly client: SupabaseHttpClient) {}

  async getSchedule(): Promise<MatchCoordinatorSchedule> {
    const rows = await this.client.rpc<ScheduleRow[]>("get_match_coordinator_schedule", {});
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("SUPABASE_MATCH_SCHEDULE_INVALID_RESPONSE");
    const row = rows[0];
    if (typeof row.has_due_runtime !== "boolean" || typeof row.has_due_fixture !== "boolean"
      || typeof row.has_due_notifications !== "boolean" || typeof row.has_pending_tournament_finalization !== "boolean"
      || typeof row.has_pending_promotion_work !== "boolean"
      || (row.next_alarm !== null && (typeof row.next_alarm !== "string" || !Number.isFinite(Date.parse(row.next_alarm))))) {
      throw new Error("SUPABASE_MATCH_SCHEDULE_INVALID_RESPONSE");
    }
    return {
      nextAlarm: row.next_alarm ? new Date(row.next_alarm) : null,
      hasDueRuntime: row.has_due_runtime, hasDueFixture: row.has_due_fixture,
      hasDueNotifications: row.has_due_notifications,
      hasPendingTournamentFinalization: row.has_pending_tournament_finalization,
      hasPendingPromotionWork: row.has_pending_promotion_work,
    };
  }

  async claim(input: MatchRuntimeLeaseClaimCommand): Promise<MatchRuntimeLease[]> {
    const rows = await this.client.rpc<ClaimRow[]>("claim_due_match_runtimes", {
      p_worker_id: input.workerId, p_now: input.now, p_lease_ms: input.leaseMs, p_limit: input.limit,
    });
    if (!Array.isArray(rows) || rows.some((row) =>
      !row || typeof row.runtime_id !== "string" || !row.runtime_id
      || typeof row.lease_token !== "string" || !row.lease_token
      || typeof row.lease_expires_at !== "string" || !Number.isFinite(Date.parse(row.lease_expires_at)))) {
      throw new Error("SUPABASE_MATCH_RUNTIME_CLAIM_INVALID_RESPONSE");
    }
    return rows.map((row) => ({
      runtime: { id: row.runtime_id },
      lease: { owner: input.workerId, token: row.lease_token, expiresAt: new Date(row.lease_expires_at) },
    }));
  }

  async release(input: MatchRuntimeLeaseReleaseCommand): Promise<boolean> {
    const rows = await this.client.rpc<ReleaseRow[]>("release_match_runtime_lease", {
      p_runtime_id: input.runtimeId, p_lease_token: input.leaseToken,
      p_next_action_at: input.nextActionAt, p_last_error: input.lastError,
    });
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.released !== "boolean") {
      throw new Error("SUPABASE_MATCH_RUNTIME_RELEASE_INVALID_RESPONSE");
    }
    return rows[0].released;
  }
}
