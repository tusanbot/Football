export interface GroupActorStatus {
  userExists: boolean;
  userSuspended: boolean;
  groupExists: boolean;
  groupSuspended: boolean;
}
export interface GroupRegistrationInput {
  telegramUserId: string; telegramGroupId: string; title: string;
  role: "OWNER" | "ADMIN"; memberCount: number;
}
export interface GroupJoinInput {
  telegramUserId: string; telegramGroupId: string; memberCount: number;
}
export interface GroupMembershipPort {
  getActorStatus(telegramUserId: string, telegramGroupId?: string): Promise<GroupActorStatus>;
  registerGroup(input: GroupRegistrationInput, now?: Date): Promise<unknown>;
  joinGroup(input: GroupJoinInput, now?: Date): Promise<unknown>;
  syncMember(input: { telegramGroupId: string; telegramUserId: string; isMember: boolean; role?: "OWNER" | "ADMIN" | "MEMBER" }): Promise<unknown>;
  checkMemberCount(input: { telegramGroupId: string; memberCount: number; botPresent: boolean }): Promise<unknown>;
  awardActivity(input: { telegramUserId: string; telegramGroupId: string; activityType: string; referenceId?: string }): Promise<unknown>;
  listMyGroups(telegramUserId: string): Promise<unknown>;
  getGroupSummary(telegramUserId: string, telegramGroupId: string): Promise<unknown>;
  getWorkspace(telegramUserId: string, telegramGroupId: string): Promise<unknown>;
  listShop(telegramUserId: string, telegramGroupId: string): Promise<unknown>;
  purchaseReward(input: { telegramUserId: string; telegramGroupId: string; itemSlug: string; recipientTelegramId?: string; idempotencyKey: string }): Promise<unknown>;
  createChallenge(input: { telegramUserId: string; telegramGroupId: string; title: string; startsAt: Date; endsAt: Date; rewardPoints: string; idempotencyKey: string }): Promise<unknown>;
  joinChallenge(input: { telegramUserId: string; telegramGroupId: string; challengeId: string }): Promise<unknown>;
  completeChallenge(input: { telegramUserId: string; telegramGroupId: string; challengeId: string; winnerTelegramId: string }): Promise<unknown>;
  cancelChallenge(input: { telegramUserId: string; telegramGroupId: string; challengeId: string }): Promise<unknown>;
}
export class GroupMembershipPortError extends Error {
  constructor(readonly code: string) { super(code); this.name = "GroupMembershipPortError"; }
}
import { AsyncLocalStorage } from "node:async_hooks";
const scope = new AsyncLocalStorage<GroupMembershipPort>();
export function withGroupMembershipPort<T>(port: GroupMembershipPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getGroupMembershipPort(): GroupMembershipPort | undefined { return scope.getStore(); }
