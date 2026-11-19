import type { GroupActorStatus, GroupJoinInput, GroupMembershipPort, GroupRegistrationInput } from "../../../../apps/api/src/groups/group-membership-context.js";
import { GroupMembershipPortError } from "../../../../apps/api/src/groups/group-membership-context.js";
import { SupabaseHttpClient, SupabaseHttpError } from "../supabase-http.js";

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SUPABASE_GROUP_MEMBERSHIP_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function raiseBusinessError(value: Record<string, unknown>): void {
  if (typeof value.error === "string") throw new GroupMembershipPortError(value.error);
}
export class SupabaseGroupMembershipRepository implements GroupMembershipPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async getActorStatus(telegramUserId: string, telegramGroupId?: string): Promise<GroupActorStatus> {
    const value = ensureObject(await this.client.rpc("get_group_actor_status_http", {
      p_telegram_user_id: telegramUserId, p_telegram_group_id: telegramGroupId ?? null,
    }));
    if (typeof value.userExists !== "boolean" || typeof value.userSuspended !== "boolean"
      || typeof value.groupExists !== "boolean" || typeof value.groupSuspended !== "boolean") {
      throw new Error("SUPABASE_GROUP_ACTOR_STATUS_INVALID_RESPONSE");
    }
    return value as unknown as GroupActorStatus;
  }
  async registerGroup(input: GroupRegistrationInput, now = new Date()): Promise<unknown> {
    const value = ensureObject(await this.client.rpc("register_telegram_group_http", {
      p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId,
      p_title: input.title, p_role: input.role, p_member_count: input.memberCount, p_now: now.toISOString(),
    }));
    raiseBusinessError(value);
    return value;
  }
  async syncMember(input: { telegramGroupId: string; telegramUserId: string; isMember: boolean; role?: "OWNER" | "ADMIN" | "MEMBER" }): Promise<unknown> {
    const value = ensureObject(await this.client.rpc("sync_telegram_group_member_http", {
      p_telegram_group_id: input.telegramGroupId, p_telegram_user_id: input.telegramUserId,
      p_is_member: input.isMember, p_role: input.role ?? "MEMBER",
    }));
    raiseBusinessError(value);
    return value;
  }
  async checkMemberCount(input: { telegramGroupId: string; memberCount: number; botPresent: boolean }): Promise<unknown> {
    const value = ensureObject(await this.client.rpc("check_telegram_group_members_http", {
      p_telegram_group_id: input.telegramGroupId, p_member_count: input.memberCount, p_bot_present: input.botPresent,
    }));
    raiseBusinessError(value);
    return value;
  }
  async awardActivity(input: { telegramUserId: string; telegramGroupId: string; activityType: string; referenceId?: string }): Promise<unknown> {
    const value = ensureObject(await this.client.rpc("award_group_activity_http", {
      p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId,
      p_activity_type: input.activityType, p_reference_id: input.referenceId ?? null,
    }));
    raiseBusinessError(value);
    return value;
  }
  async listMyGroups(telegramUserId: string): Promise<unknown> {
    const value = ensureObject(await this.client.rpc("list_my_telegram_groups_http", { p_telegram_user_id: telegramUserId }));
    raiseBusinessError(value);
    return value;
  }
  async getGroupSummary(telegramUserId: string, telegramGroupId: string): Promise<unknown> {
    const value = ensureObject(await this.client.rpc("get_telegram_group_summary_http", {
      p_telegram_user_id: telegramUserId, p_telegram_group_id: telegramGroupId,
    }));
    raiseBusinessError(value);
    return value;
  }
  async getWorkspace(telegramUserId: string, telegramGroupId: string): Promise<unknown> {
    const value = ensureObject(await this.client.rpc("get_telegram_group_workspace_http", {
      p_telegram_user_id: telegramUserId, p_telegram_group_id: telegramGroupId,
    }));
    raiseBusinessError(value);
    return value;
  }
  private async groupRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const value = ensureObject(await this.client.rpc(name, args));
      raiseBusinessError(value);
      return value;
    } catch (error) {
      if (error instanceof SupabaseHttpError && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) {
        throw new GroupMembershipPortError(error.message);
      }
      throw error;
    }
  }
  async listShop(telegramUserId: string, telegramGroupId: string): Promise<unknown> {
    return this.groupRpc("list_group_shop_http", { p_telegram_user_id: telegramUserId, p_telegram_group_id: telegramGroupId });
  }
  async purchaseReward(input: { telegramUserId: string; telegramGroupId: string; itemSlug: string; recipientTelegramId?: string; idempotencyKey: string }): Promise<unknown> {
    return this.groupRpc("purchase_group_reward_http", { p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId, p_item_slug: input.itemSlug, p_recipient_telegram_id: input.recipientTelegramId ?? null, p_idempotency_key: input.idempotencyKey });
  }
  async createChallenge(input: { telegramUserId: string; telegramGroupId: string; title: string; startsAt: Date; endsAt: Date; rewardPoints: string; idempotencyKey: string }): Promise<unknown> {
    return this.groupRpc("create_group_challenge_http", { p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId, p_title: input.title, p_starts_at: input.startsAt.toISOString(), p_ends_at: input.endsAt.toISOString(), p_reward_points: input.rewardPoints, p_idempotency_key: input.idempotencyKey });
  }
  async joinChallenge(input: { telegramUserId: string; telegramGroupId: string; challengeId: string }): Promise<unknown> {
    return this.groupRpc("join_group_challenge_http", { p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId, p_challenge_id: input.challengeId });
  }
  async completeChallenge(input: { telegramUserId: string; telegramGroupId: string; challengeId: string; winnerTelegramId: string }): Promise<unknown> {
    return this.groupRpc("complete_group_challenge_http", { p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId, p_challenge_id: input.challengeId, p_winner_telegram_id: input.winnerTelegramId });
  }
  async cancelChallenge(input: { telegramUserId: string; telegramGroupId: string; challengeId: string }): Promise<unknown> {
    return this.groupRpc("cancel_group_challenge_http", { p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId, p_challenge_id: input.challengeId });
  }

  async createLeague(input: { telegramUserId: string; telegramGroupId: string; name: string; maxTeams: number; idempotencyKey: string; now?: Date }): Promise<unknown> {
    return this.groupRpc("create_group_league_http", {
      p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId,
      p_name: input.name, p_max_teams: input.maxTeams, p_idempotency_key: input.idempotencyKey,
      p_now: (input.now ?? new Date()).toISOString(),
    });
  }
  async joinLeague(input: { telegramUserId: string; telegramGroupId: string; competitionId: string; now?: Date }): Promise<unknown> {
    return this.groupRpc("join_group_league_http", {
      p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId,
      p_competition_id: input.competitionId, p_now: (input.now ?? new Date()).toISOString(),
    });
  }
  async startLeague(input: { telegramUserId: string; telegramGroupId: string; competitionId: string; now?: Date }): Promise<unknown> {
    return this.groupRpc("start_group_league_http", {
      p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId,
      p_competition_id: input.competitionId, p_now: (input.now ?? new Date()).toISOString(),
    });
  }
  async getLeagueTable(input: { telegramUserId: string; telegramGroupId: string; competitionId: string }): Promise<unknown> {
    return this.groupRpc("get_group_league_table_http", {
      p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId,
      p_competition_id: input.competitionId,
    });
  }
  async listLeagues(input: { telegramUserId: string; telegramGroupId: string }): Promise<unknown> {
    return this.groupRpc("list_group_leagues_http", {
      p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId,
    });
  }

  async joinGroup(input: GroupJoinInput, now = new Date()): Promise<unknown> {
    const value = ensureObject(await this.client.rpc("join_telegram_group_http", {
      p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId,
      p_member_count: input.memberCount, p_now: now.toISOString(),
    }));
    raiseBusinessError(value);
    return value;
  }
}
