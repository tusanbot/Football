import { Prisma, type GroupRole } from "@prisma/client";
import { prisma } from "../db.js";

export class GroupServiceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "GroupServiceError"; }
}

const MIN_TELEGRAM_MEMBERS = 10;
async function requireClubOwner(tx: Prisma.TransactionClient, telegramId: string) {
  const user = await tx.user.findUnique({ where: { telegramId }, select: { id: true, club: { select: { id: true } } } });
  if (!user) throw new GroupServiceError("ACCOUNT_NOT_FOUND");
  if (!user.club) throw new GroupServiceError("CLUB_NOT_FOUND");
  return user;
}

export async function registerTelegramGroup(input: { telegramUserId: string; telegramGroupId: string; title: string; role: Extract<GroupRole, "OWNER" | "ADMIN">; memberCount: number }) {
  if (input.memberCount < MIN_TELEGRAM_MEMBERS) throw new GroupServiceError("GROUP_MINIMUM_MEMBERS_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const user = await requireClubOwner(tx, input.telegramUserId);
    const now = new Date();
    const group = await tx.telegramGroup.upsert({
      where: { telegramId: input.telegramGroupId },
      create: { telegramId: input.telegramGroupId, title: input.title, memberCount: input.memberCount, isActive: true, lastMemberCountCheckAt: now },
      update: { title: input.title, memberCount: input.memberCount, isActive: true, lastMemberCountCheckAt: now },
      select: { id: true, telegramId: true, title: true, memberCount: true, isActive: true, points: true },
    });
    const membership = await tx.groupMembership.upsert({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
      create: { groupId: group.id, userId: user.id, role: input.role },
      update: { role: input.role }, select: { role: true },
    });
    const registeredManagers = await tx.groupMembership.count({ where: { groupId: group.id } });
    return { group, role: membership.role, registeredManagers, minimumMembers: MIN_TELEGRAM_MEMBERS };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function joinTelegramGroup(input: { telegramUserId: string; telegramGroupId: string; memberCount: number }) {
  if (input.memberCount < MIN_TELEGRAM_MEMBERS) {
    await prisma.telegramGroup.updateMany({ where: { telegramId: input.telegramGroupId }, data: { memberCount: input.memberCount, isActive: false, lastMemberCountCheckAt: new Date() } });
    throw new GroupServiceError("GROUP_MINIMUM_MEMBERS_REQUIRED");
  }
  return prisma.$transaction(async (tx) => {
    const user = await requireClubOwner(tx, input.telegramUserId);
    const group = await tx.telegramGroup.findUnique({ where: { telegramId: input.telegramGroupId }, select: { id: true, telegramId: true, title: true, isActive: true } });
    if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
    if (!group.isActive) throw new GroupServiceError("GROUP_INACTIVE");
    const existing = await tx.groupMembership.findUnique({ where: { groupId_userId: { groupId: group.id, userId: user.id } }, select: { id: true } });
    const membership = await tx.groupMembership.upsert({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
      create: { groupId: group.id, userId: user.id, role: "MEMBER" }, update: {}, select: { role: true },
    });
    await tx.telegramGroup.update({ where: { id: group.id }, data: { memberCount: input.memberCount, lastMemberCountCheckAt: new Date() } });
    const registeredManagers = await tx.groupMembership.count({ where: { groupId: group.id } });
    return { group, role: membership.role, registeredManagers, alreadyJoined: Boolean(existing), memberCount: input.memberCount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function awardDailyGroupActivity(input: { telegramUserId: string; telegramGroupId: string }) {
  return prisma.$transaction(async (tx) => {
    const user = await requireClubOwner(tx, input.telegramUserId);
    const group = await tx.telegramGroup.findUnique({ where: { telegramId: input.telegramGroupId }, select: { id: true, isActive: true, points: true, memberships: { where: { userId: user.id }, select: { id: true } } } });
    if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
    if (!group.isActive) throw new GroupServiceError("GROUP_INACTIVE");
    if (group.memberships.length === 0) throw new GroupServiceError("NOT_GROUP_MEMBER");
    const day = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `group-daily-activity:${group.id}:${user.id}:${day}`;
    const existing = await tx.groupPointLedger.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) return { awarded: false, replayed: true, points: group.points.toString(), award: "0" };
    await tx.groupPointLedger.create({ data: { idempotencyKey, groupId: group.id, userId: user.id, amount: 1n, source: "DAILY_ACTIVITY", description: "Daily member activity" } });
    const updated = await tx.telegramGroup.update({ where: { id: group.id }, data: { points: { increment: 1n } }, select: { points: true } });
    return { awarded: true, replayed: false, points: updated.points.toString(), award: "1" };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getTelegramGroupSummary(telegramUserId: string, telegramGroupId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId: telegramUserId }, select: { id: true } });
  if (!user) throw new GroupServiceError("ACCOUNT_NOT_FOUND");
  const group = await prisma.telegramGroup.findUnique({
    where: { telegramId: telegramGroupId },
    select: { id: true, telegramId: true, title: true, memberCount: true, isActive: true, points: true, _count: { select: { memberships: true } }, memberships: { where: { userId: user.id }, select: { role: true } } },
  });
  if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
  const membership = group.memberships[0];
  if (!membership) throw new GroupServiceError("NOT_GROUP_MEMBER");
  return {
    group: { id: group.id, telegramId: group.telegramId, title: group.title, memberCount: group.memberCount, isActive: group.isActive, points: group.points.toString() },
    role: membership.role, registeredManagers: group._count.memberships, minimumMembers: MIN_TELEGRAM_MEMBERS,
  };
}
