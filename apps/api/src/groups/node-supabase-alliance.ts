import type { AlliancePort } from "./alliance-context.js";
import { AllianceServiceError } from "./alliance-service.js";

export interface AdminAlliancePort extends Pick<AlliancePort, "consumeRateLimit"> {
  adminStartAllianceSeason(input: { actorTelegramId: string; allianceId: string; durationDays?: number; idempotencyKey: string; reason?: string }): Promise<unknown>;
  adminCloseAllianceSeason(input: { actorTelegramId: string; seasonId: string; idempotencyKey: string; reason?: string }): Promise<unknown>;
  adminReviewAllianceSeason(input: { actorTelegramId: string; seasonId: string; decision: "APPROVE" | "REJECT"; idempotencyKey: string; reason?: string }): Promise<unknown>;
}

/** Server-only Supabase PostgREST transport for the Node Fastify alliance domain. */
export class NodeSupabaseAllianceRepository implements AlliancePort {
  private readonly baseUrl: string;
  constructor(url: string, private readonly serviceRoleKey: string, private readonly timeoutMs = 10_000) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\\.supabase\\.co$/i.test(parsed.hostname)
      || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new TypeError("SUPABASE_URL must be a direct HTTPS Supabase project origin");
    }
    if (!serviceRoleKey || serviceRoleKey.trim().length < 20) throw new TypeError("SUPABASE_SERVICE_ROLE_KEY is required");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new RangeError("Invalid Supabase HTTP timeout");
    this.baseUrl = parsed.origin;
  }
  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new TypeError("Invalid Supabase RPC name");
    let response: Response;
    try {
      response = await fetch(this.baseUrl + "/rest/v1/rpc/" + name, {
        method: "POST", redirect: "error",
        headers: { apikey: this.serviceRoleKey, authorization: "Bearer " + this.serviceRoleKey, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(args), signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) { throw new Error("Supabase alliance RPC request failed", { cause: error }); }
    const text = await response.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : null; } catch { throw new Error("Supabase alliance RPC returned invalid JSON"); }
    const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
    if (!response.ok) {
      const message = typeof value?.message === "string" ? value.message : "";
      if (/^[A-Z][A-Z0-9_]{2,80}$/.test(message)) throw new AllianceServiceError(message);
      throw new Error("Supabase alliance RPC was rejected (" + response.status + ")");
    }
    if (!value) throw new Error("SUPABASE_ALLIANCE_INVALID_RESPONSE");
    if (typeof value.error === "string") throw new AllianceServiceError(value.error);
    return payload;
  }
  createAlliance(i: Parameters<AlliancePort["createAlliance"]>[0]) { return this.rpc("create_alliance_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_name:i.name,p_description:i.description??"",p_idempotency_key:i.idempotencyKey }); }
  inviteAllianceGroup(i: Parameters<AlliancePort["inviteAllianceGroup"]>[0]) { return this.rpc("invite_alliance_group_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_target_telegram_group_id:i.targetTelegramGroupId }); }
  respondAllianceInvitation(i: Parameters<AlliancePort["respondAllianceInvitation"]>[0]) { return this.rpc("respond_alliance_invitation_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_invitation_id:i.invitationId,p_accept:i.accept }); }
  contributeAllianceTreasury(i: Parameters<AlliancePort["contributeAllianceTreasury"]>[0]) { return this.rpc("contribute_alliance_treasury_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_amount:i.amount,p_idempotency_key:i.idempotencyKey }); }
  getAllianceWorkspace(i: Parameters<AlliancePort["getAllianceWorkspace"]>[0]) { return this.rpc("get_alliance_workspace_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_is_reviewer:i.isReviewer }); }
  startAllianceSeason(i: Parameters<AlliancePort["startAllianceSeason"]>[0]) { return this.rpc("start_alliance_season_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_duration_days:i.durationDays??null }); }
  closeAllianceSeason(i: Parameters<AlliancePort["closeAllianceSeason"]>[0]) { return this.rpc("close_alliance_season_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId }); }
  reviewAllianceSeason(i: Parameters<AlliancePort["reviewAllianceSeason"]>[0]) { return this.rpc("review_alliance_season_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_season_id:i.seasonId,p_decision:i.decision,p_is_reviewer:i.isReviewer }); }
  createAllianceChampionship(i: Parameters<AlliancePort["createAllianceChampionship"]>[0]) { return this.rpc("create_alliance_championship_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_name:i.name,p_max_teams:i.maxTeams,p_idempotency_key:i.idempotencyKey }); }
  joinAllianceChampionship(i: Parameters<AlliancePort["joinAllianceChampionship"]>[0]) { return this.rpc("join_alliance_championship_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_competition_id:i.competitionId }); }
  startAllianceChampionship(i: Parameters<AlliancePort["startAllianceChampionship"]>[0]) { return this.rpc("start_alliance_championship_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_competition_id:i.competitionId,p_now:i.now }); }
  createCrossAllianceCompetition(i: Parameters<AlliancePort["createCrossAllianceCompetition"]>[0]) { return this.rpc("create_cross_alliance_competition_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_name:i.name,p_max_teams:i.maxTeams,p_idempotency_key:i.idempotencyKey }); }
  inviteCrossAllianceCompetition(i: Parameters<AlliancePort["inviteCrossAllianceCompetition"]>[0]) { return this.rpc("invite_cross_alliance_competition_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_competition_id:i.competitionId,p_target_alliance_slug:i.targetAllianceSlug }); }
  respondCrossAllianceCompetitionInvitation(i: Parameters<AlliancePort["respondCrossAllianceCompetitionInvitation"]>[0]) { return this.rpc("respond_cross_alliance_competition_invitation_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_competition_id:i.competitionId,p_accept:i.accept }); }
  joinCrossAllianceCompetition(i: Parameters<AlliancePort["joinCrossAllianceCompetition"]>[0]) { return this.rpc("join_cross_alliance_competition_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_competition_id:i.competitionId }); }
  startCrossAllianceCompetition(i: Parameters<AlliancePort["startCrossAllianceCompetition"]>[0]) { return this.rpc("start_cross_alliance_competition_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_competition_id:i.competitionId,p_now:i.now }); }
  adminStartAllianceSeason(i: Parameters<AdminAlliancePort["adminStartAllianceSeason"]>[0]) { return this.rpc("admin_start_alliance_season_http", { p_actor_telegram_id:i.actorTelegramId,p_alliance_id:i.allianceId,p_duration_days:i.durationDays??null,p_idempotency_key:i.idempotencyKey,p_reason:i.reason??null }); }
  adminCloseAllianceSeason(i: Parameters<AdminAlliancePort["adminCloseAllianceSeason"]>[0]) { return this.rpc("admin_close_alliance_season_http", { p_actor_telegram_id:i.actorTelegramId,p_season_id:i.seasonId,p_idempotency_key:i.idempotencyKey,p_reason:i.reason??null }); }
  adminReviewAllianceSeason(i: Parameters<AdminAlliancePort["adminReviewAllianceSeason"]>[0]) { return this.rpc("admin_review_alliance_season_http", { p_actor_telegram_id:i.actorTelegramId,p_season_id:i.seasonId,p_decision:i.decision,p_idempotency_key:i.idempotencyKey,p_reason:i.reason??null }); }
  async consumeRateLimit(i: Parameters<AlliancePort["consumeRateLimit"]>[0]) {
    const result = await this.rpc("consume_alliance_action_rate_limit_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_action:i.action,p_limit:i.limit,p_now:i.now });
    if (!result || typeof result !== "object" || typeof (result as Record<string,unknown>).allowed !== "boolean") throw new Error("SUPABASE_ALLIANCE_RATE_LIMIT_INVALID_RESPONSE");
    return (result as {allowed:boolean}).allowed;
  }
}
