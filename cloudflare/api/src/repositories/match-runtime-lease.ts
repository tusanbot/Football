import type {
  MatchRuntimeLeaseClaimCommand, MatchRuntimeLease, MatchRuntimeLeasePort, MatchRuntimeLeaseReleaseCommand,
} from "../../../../apps/api/src/game/match-runtime-lease-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

interface ClaimRow { runtime_id: string; lease_token: string; lease_expires_at: string; }
interface ReleaseRow { released: boolean; }

export class SupabaseMatchRuntimeLeaseRepository implements MatchRuntimeLeasePort {
  constructor(private readonly client: SupabaseHttpClient) {}

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
