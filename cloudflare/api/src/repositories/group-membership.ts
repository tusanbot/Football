import type { GroupActorStatus, GroupJoinInput, GroupMembershipPort, GroupRegistrationInput } from "../../../../apps/api/src/groups/group-membership-context.js";
import { GroupMembershipPortError } from "../../../../apps/api/src/groups/group-membership-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

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
  async joinGroup(input: GroupJoinInput, now = new Date()): Promise<unknown> {
    const value = ensureObject(await this.client.rpc("join_telegram_group_http", {
      p_telegram_user_id: input.telegramUserId, p_telegram_group_id: input.telegramGroupId,
      p_member_count: input.memberCount, p_now: now.toISOString(),
    }));
    raiseBusinessError(value);
    return value;
  }
}
