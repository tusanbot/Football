import { Prisma, type GroupRole } from "@prisma/client";
import { prisma } from "../db.js";

export class GroupServiceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "GroupServiceError"; }
}

async function requireClubOwner(tx: Prisma.TransactionClient, telegramId: string) {
  const user = await tx.user.findUnique({ where: { telegramId }, select: { id: true, club: { select: { id: true } } } });
  if (!user) throw new GroupServiceError("ACCOUNT_NOT_FOUND");
  if (!user.club) throw new GroupServiceError("CLUB_NOT_FOUND");
  return user;
}

export async function registerTelegramGroup(input: { telegramUserId: string; telegramGroupId: string; title: string; role: Extract<GroupRole, "OWNER" | "ADMIN"> }) {
  return prisma.$transaction(async (tx) => {
    const user = await requireClubOwner(tx, input.telegramUserId);
    const group = await tx.telegramGroup.upsert({ where: { telegramId: input.telegramGroupId }, create: { telegramId: input.telegramGroupId, title: input.title }, update: { title: input.title }, select: { id: true, telegramId: true, title: true } });
    const membership = await tx.groupMembership.upsert({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
      create: { groupId: group.id, userId: user.id, role: input.role },
      update: { role: input.role }, select: { role: true },
    });
    const memberCount = await tx.groupMembership.count({ where: { groupId: group.id } });
    return { group, role: membership.role, memberCount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function joinTelegramGroup(input: { telegramUserId: string; telegramGroupId: string }) {
  return prisma.$transaction(async (tx) => {
    const user = await requireClubOwner(tx, input.telegramUserId);
    const group = await tx.telegramGroup.findUnique({ where: { telegramId: input.telegramGroupId }, select: { id: true, telegramId: true, title: true } });
    if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
    const existing = await tx.groupMembership.findUnique({ where: { groupId_userId: { groupId: group.id, userId: user.id } }, select: { id: true } });
    const membership = await tx.groupMembership.upsert({
      where: { groupId_userId: { groupId: group.id, userId: user.id } },
      create: { groupId: group.id, userId: user.id, role: "MEMBER" }, update: {}, select: { role: true },
    });
    const memberCount = await tx.groupMembership.count({ where: { groupId: group.id } });
    return { group, role: membership.role, memberCount, alreadyJoined: Boolean(existing) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getTelegramGroupSummary(telegramUserId: string, telegramGroupId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId: telegramUserId }, select: { id: true } });
  if (!user) throw new GroupServiceError("ACCOUNT_NOT_FOUND");
  const group = await prisma.telegramGroup.findUnique({
    where: { telegramId: telegramGroupId },
    select: { id: true, telegramId: true, title: true, _count: { select: { memberships: true } }, memberships: { where: { userId: user.id }, select: { role: true } } },
  });
  if (!group) throw new GroupServiceError("GROUP_NOT_REGISTERED");
  const membership = group.memberships[0];
  if (!membership) throw new GroupServiceError("NOT_GROUP_MEMBER");
  return { group: { id: group.id, telegramId: group.telegramId, title: group.title }, role: membership.role, memberCount: group._count.memberships };
}
