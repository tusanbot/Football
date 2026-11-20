import type { GroupActorStatus, GroupJoinInput, GroupMembershipPort, GroupRegistrationInput } from "./group-membership-context.js";
import { GroupMembershipPortError } from "./group-membership-context.js";

/** Node API transport for the same server-only Supabase RPC contract used by the Worker. */
export class NodeSupabaseGroupMembershipRepository implements GroupMembershipPort {
  private readonly baseUrl: string;
  constructor(url: string, private readonly serviceRoleKey: string, private readonly timeoutMs = 10_000) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)
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
    } catch (error) { throw new Error("Supabase group RPC request failed", { cause: error }); }
    const text = await response.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : null; } catch { throw new Error("Supabase group RPC returned invalid JSON"); }
    if (!response.ok) {
      const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const message = typeof value.message === "string" ? value.message : "";
      if (/^[A-Z][A-Z0-9_]{2,80}$/.test(message)) throw new GroupMembershipPortError(message);
      throw new Error("Supabase group RPC was rejected (" + response.status + ")");
    }
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const businessError = (payload as Record<string, unknown>).error;
      if (typeof businessError === "string") throw new GroupMembershipPortError(businessError);
    }
    return payload;
  }
  private object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SUPABASE_GROUP_MEMBERSHIP_INVALID_RESPONSE");
    return value as Record<string, unknown>;
  }
  private groupRpc(name: string, args: Record<string, unknown>) { return this.rpc(name, args); }
  async getActorStatus(user: string, group?: string): Promise<GroupActorStatus> {
    const value = this.object(await this.rpc("get_group_actor_status_http", { p_telegram_user_id: user, p_telegram_group_id: group ?? null }));
    for (const key of ["userExists", "userSuspended", "groupExists", "groupSuspended"]) if (typeof value[key] !== "boolean") throw new Error("SUPABASE_GROUP_ACTOR_STATUS_INVALID_RESPONSE");
    return value as unknown as GroupActorStatus;
  }
  registerGroup(i: GroupRegistrationInput, now = new Date()) { return this.rpc("register_telegram_group_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_title:i.title,p_role:i.role,p_member_count:i.memberCount,p_now:now.toISOString() }); }
  joinGroup(i: GroupJoinInput, now = new Date()) { return this.rpc("join_telegram_group_http", { p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_member_count:i.memberCount,p_now:now.toISOString() }); }
  syncMember(i: {telegramGroupId:string;telegramUserId:string;isMember:boolean;role?:"OWNER"|"ADMIN"|"MEMBER"}) { return this.rpc("sync_telegram_group_member_http",{p_telegram_group_id:i.telegramGroupId,p_telegram_user_id:i.telegramUserId,p_is_member:i.isMember,p_role:i.role??"MEMBER"}); }
  checkMemberCount(i: {telegramGroupId:string;memberCount:number;botPresent:boolean}) { return this.rpc("check_telegram_group_members_http",{p_telegram_group_id:i.telegramGroupId,p_member_count:i.memberCount,p_bot_present:i.botPresent}); }
  awardActivity(i: {telegramUserId:string;telegramGroupId:string;activityType:string;referenceId?:string}) { return this.rpc("award_group_activity_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_activity_type:i.activityType,p_reference_id:i.referenceId??null}); }
  listMyGroups(user:string) { return this.rpc("list_my_telegram_groups_http",{p_telegram_user_id:user}); }
  getGroupSummary(user:string,group:string) { return this.rpc("get_telegram_group_summary_http",{p_telegram_user_id:user,p_telegram_group_id:group}); }
  getWorkspace(user:string,group:string) { return this.rpc("get_telegram_group_workspace_http",{p_telegram_user_id:user,p_telegram_group_id:group}); }
  listShop(user:string,group:string) { return this.groupRpc("list_group_shop_http",{p_telegram_user_id:user,p_telegram_group_id:group}); }
  purchaseReward(i:{telegramUserId:string;telegramGroupId:string;itemSlug:string;recipientTelegramId?:string;idempotencyKey:string}) { return this.groupRpc("purchase_group_reward_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_item_slug:i.itemSlug,p_recipient_telegram_id:i.recipientTelegramId??null,p_idempotency_key:i.idempotencyKey}); }
  createChallenge(i:{telegramUserId:string;telegramGroupId:string;title:string;startsAt:Date;endsAt:Date;rewardPoints:string;idempotencyKey:string}) { return this.groupRpc("create_group_challenge_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_title:i.title,p_starts_at:i.startsAt.toISOString(),p_ends_at:i.endsAt.toISOString(),p_reward_points:i.rewardPoints,p_idempotency_key:i.idempotencyKey}); }
  joinChallenge(i:{telegramUserId:string;telegramGroupId:string;challengeId:string}) { return this.groupRpc("join_group_challenge_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_challenge_id:i.challengeId}); }
  completeChallenge(i:{telegramUserId:string;telegramGroupId:string;challengeId:string;winnerTelegramId:string}) { return this.groupRpc("complete_group_challenge_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_challenge_id:i.challengeId,p_winner_telegram_id:i.winnerTelegramId}); }
  cancelChallenge(i:{telegramUserId:string;telegramGroupId:string;challengeId:string}) { return this.groupRpc("cancel_group_challenge_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_challenge_id:i.challengeId}); }
  createLeague(i:{telegramUserId:string;telegramGroupId:string;name:string;maxTeams:number;idempotencyKey:string;now?:Date}) { return this.groupRpc("create_group_league_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_name:i.name,p_max_teams:i.maxTeams,p_idempotency_key:i.idempotencyKey,p_now:(i.now??new Date()).toISOString()}); }
  joinLeague(i:{telegramUserId:string;telegramGroupId:string;competitionId:string;now?:Date}) { return this.groupRpc("join_group_league_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_competition_id:i.competitionId,p_now:(i.now??new Date()).toISOString()}); }
  startLeague(i:{telegramUserId:string;telegramGroupId:string;competitionId:string;now?:Date}) { return this.groupRpc("start_group_league_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_competition_id:i.competitionId,p_now:(i.now??new Date()).toISOString()}); }
  getLeagueTable(i:{telegramUserId:string;telegramGroupId:string;competitionId:string}) { return this.groupRpc("get_group_league_table_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId,p_competition_id:i.competitionId}); }
  listLeagues(i:{telegramUserId:string;telegramGroupId:string}) { return this.groupRpc("list_group_leagues_http",{p_telegram_user_id:i.telegramUserId,p_telegram_group_id:i.telegramGroupId}); }
}
