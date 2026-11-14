import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { startLeague } from "../game/match-service.js";

export class AllianceServiceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AllianceServiceError"; }
}

async function manager(tx: Prisma.TransactionClient, telegramId: string, telegramGroupId: string, requireManager = true) {
  const user = await tx.user.findUnique({ where: { telegramId }, select: { id: true, club: { select: { id: true, name: true } } } });
  if (!user) throw new AllianceServiceError("ACCOUNT_NOT_FOUND");
  if (!user.club) throw new AllianceServiceError("CLUB_NOT_FOUND");
  const group = await tx.telegramGroup.findUnique({ where: { telegramId: telegramGroupId }, select: { id: true, telegramId: true, title: true, isActive: true, memberships: { where: { userId: user.id }, select: { role: true } } } });
  if (!group) throw new AllianceServiceError("GROUP_NOT_REGISTERED");
  if (!group.isActive) throw new AllianceServiceError("GROUP_INACTIVE");
  if (!group.memberships.length) throw new AllianceServiceError("NOT_GROUP_MEMBER");
  if (requireManager && group.memberships[0]!.role === "MEMBER") throw new AllianceServiceError("GROUP_MANAGER_REQUIRED");
  return { user, group };
}

export async function createAlliance(i: { telegramUserId: string; telegramGroupId: string; name: string; description?: string; idempotencyKey: string }) {
  return prisma.$transaction(async tx => {
    const { group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const old = await tx.alliance.findUnique({ where: { slug: i.idempotencyKey } });
    if (old) {
      if (old.createdByGroupId !== group.id) throw new AllianceServiceError("IDEMPOTENCY_CONFLICT");
      return { alliance: old, replayed: true };
    }
    const existing = await tx.allianceGroup.findUnique({ where: { groupId: group.id }, include: { alliance: true } });
    if (existing) throw new AllianceServiceError("GROUP_ALREADY_IN_ALLIANCE");
    const slug = i.idempotencyKey;
    const alliance = await tx.alliance.create({ data: { slug, name: i.name, description: i.description ?? "", createdByGroupId: group.id, groups: { create: { groupId: group.id, role: "FOUNDER" } } } });
    await tx.allianceSeason.create({ data: { allianceId: alliance.id, number: 1, endsAt: new Date(Date.now() + 30 * 86400000) } });
    return { alliance, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function inviteAllianceGroup(i: { telegramUserId: string; telegramGroupId: string; targetTelegramGroupId: string }) {
  return prisma.$transaction(async tx => {
    const { group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id }, include: { alliance: true } });
    if (!membership || membership.alliance.status !== "ACTIVE") throw new AllianceServiceError("ALLIANCE_NOT_FOUND");
    const target = await tx.telegramGroup.findUnique({ where: { telegramId: i.targetTelegramGroupId }, select: { id: true, isActive: true } });
    if (!target) throw new AllianceServiceError("TARGET_GROUP_NOT_FOUND");
    if (!target.isActive) throw new AllianceServiceError("TARGET_GROUP_INACTIVE");
    if (target.id === group.id) throw new AllianceServiceError("CANNOT_INVITE_SELF");
    if (await tx.allianceGroup.findUnique({ where: { groupId: target.id } })) throw new AllianceServiceError("TARGET_ALREADY_IN_ALLIANCE");
    const invitation = await tx.allianceInvitation.upsert({
      where: { allianceId_groupId: { allianceId: membership.allianceId, groupId: target.id } },
      create: { allianceId: membership.allianceId, groupId: target.id, invitedByGroupId: group.id },
      update: { status: "PENDING", invitedByGroupId: group.id, respondedAt: null },
    });
    return { invitation, alliance: { id: membership.alliance.id, name: membership.alliance.name } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


export async function contributeAllianceTreasury(i: { telegramUserId: string; telegramGroupId: string; amount: bigint; idempotencyKey: string }) {
  if (i.amount <= 0n || i.amount > 1000000000n) throw new AllianceServiceError("INVALID_CONTRIBUTION_AMOUNT");
  return prisma.$transaction(async tx => {
    const { group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id } });
    if (!membership) throw new AllianceServiceError("ALLIANCE_NOT_FOUND");
    const old = await tx.allianceLedger.findUnique({ where: { idempotencyKey: i.idempotencyKey } });
    if (old) {
      if (old.allianceId !== membership.allianceId) throw new AllianceServiceError("IDEMPOTENCY_CONFLICT");
      return { contributed: true, replayed: true, treasuryPoints: (await tx.alliance.findUniqueOrThrow({where:{id:membership.allianceId},select:{treasuryPoints:true}})).treasuryPoints.toString() };
    }
    const debited = await tx.telegramGroup.updateMany({ where: { id: group.id, points: { gte: i.amount } }, data: { points: { decrement: i.amount } } });
    if (!debited.count) throw new AllianceServiceError("INSUFFICIENT_GROUP_POINTS");
    const alliance = await tx.alliance.update({ where: { id: membership.allianceId }, data: { treasuryPoints: { increment: i.amount } }, select: { treasuryPoints: true } });
    await tx.allianceLedger.create({ data: { allianceId: membership.allianceId, idempotencyKey: i.idempotencyKey, amount: i.amount, source: "GROUP_CONTRIBUTION", description: "Contribution from Telegram group " + group.title } });
    await tx.groupPointLedger.create({ data: { idempotencyKey: "alliance-contribution:" + i.idempotencyKey, groupId: group.id, amount: -i.amount, source: "ADMIN_ADJUSTMENT", description: "Contribution to alliance treasury" } });
    return { contributed: true, replayed: false, treasuryPoints: alliance.treasuryPoints.toString(), groupPoints: (group.id ? (await tx.telegramGroup.findUniqueOrThrow({where:{id:group.id},select:{points:true}})).points.toString() : "0") };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function respondAllianceInvitation(i: { telegramUserId: string; telegramGroupId: string; invitationId: string; accept: boolean }) {
  return prisma.$transaction(async tx => {
    const { group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const invitation = await tx.allianceInvitation.findFirst({ where: { id: i.invitationId, groupId: group.id }, include: { alliance: true } });
    if (!invitation) throw new AllianceServiceError("INVITATION_NOT_FOUND");
    if (invitation.status !== "PENDING") return { accepted: invitation.status === "ACCEPTED", replayed: true };
    if (i.accept) {
      if (invitation.alliance.status !== "ACTIVE") throw new AllianceServiceError("ALLIANCE_INACTIVE");
      const current = await tx.allianceGroup.findUnique({ where: { groupId: group.id } });
      if (current) throw new AllianceServiceError("GROUP_ALREADY_IN_ALLIANCE");
      await tx.allianceGroup.create({ data: { allianceId: invitation.allianceId, groupId: group.id } });
    }
    await tx.allianceInvitation.update({ where: { id: invitation.id }, data: { status: i.accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() } });
    return { accepted: i.accept, replayed: false, allianceName: invitation.alliance.name };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getAllianceWorkspace(telegramUserId: string, telegramGroupId: string) {
  const { group } = await prisma.$transaction(tx => manager(tx, telegramUserId, telegramGroupId, false));
  const membership = await prisma.allianceGroup.findUnique({ where: { groupId: group.id }, include: { alliance: true } });
  if (!membership) {
    const invitations = await prisma.allianceInvitation.findMany({
      where: { groupId: group.id, status: "PENDING" },
      include: { alliance: { select: { name: true, description: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { alliance: null, invitations };
  }
  const allianceId = membership.allianceId;
  const [groups, seasons, competitions] = await Promise.all([
    prisma.allianceGroup.findMany({
      where: { allianceId },
      include: { group: { select: { telegramId: true, title: true, memberCount: true, points: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.allianceSeason.findMany({ where: { allianceId }, orderBy: { number: "desc" }, take: 5 }),
    prisma.competition.findMany({
      where: { allianceId, status: { in: ["REGISTRATION", "ACTIVE", "COMPLETED"] } },
      include: {
        _count: { select: { entries: true } },
        entries: {
          include: { club: { select: { name: true } } },
          orderBy: [{ points: "desc" }, { goalsFor: "desc" }, { goalsAgainst: "asc" }],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  return {
    alliance: {
      id: membership.alliance.id,
      name: membership.alliance.name,
      description: membership.alliance.description,
      treasuryPoints: membership.alliance.treasuryPoints.toString(),
      groups: groups.map(x => ({ title: x.group.title, telegramGroupId: x.group.telegramId, memberCount: x.group.memberCount, points: x.group.points.toString(), role: x.role })),
      seasons,
      competitions: competitions.map(x => ({
        id: x.id, name: x.name, status: x.status, teams: x._count.entries,
        standings: x.entries.map((entry, index) => ({ rank: index + 1, club: entry.club.name, played: entry.played, points: entry.points, goalsFor: entry.goalsFor, goalsAgainst: entry.goalsAgainst })),
      })),
    },
    invitations: [],
  };
}

export async function createAllianceChampionship(i: { telegramUserId: string; telegramGroupId: string; name: string; maxTeams: number; idempotencyKey: string }) {
  return prisma.$transaction(async tx => {
    const { user, group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id }, include: { alliance: true } });
    if (!membership || membership.alliance.status !== "ACTIVE") throw new AllianceServiceError("ALLIANCE_NOT_FOUND");
    const clubId = user.club!.id;
    const existing = await tx.competition.findUnique({ where: { idempotencyKey: i.idempotencyKey } });
    if (existing) {
      if (existing.allianceId !== membership.allianceId || existing.createdByClubId !== clubId) throw new AllianceServiceError("IDEMPOTENCY_CONFLICT");
      return { competition: existing, replayed: true };
    }
    const season = await tx.allianceSeason.findFirst({ where: { allianceId: membership.allianceId, status: "ACTIVE" }, orderBy: { number: "desc" } });
    const competition = await tx.competition.create({ data: { idempotencyKey: i.idempotencyKey, name: i.name, season: season?.number ?? 1, format: "LEAGUE", maxTeams: i.maxTeams, createdByClubId: clubId, allianceId: membership.allianceId, ...(season ? { allianceSeasonId: season.id } : {}), entries: { create: { clubId } } } });
    return { competition, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function joinAllianceChampionship(i: { telegramUserId: string; telegramGroupId: string; competitionId: string }) {
  return prisma.$transaction(async tx => {
    const { user, group } = await manager(tx, i.telegramUserId, i.telegramGroupId, false);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id } });
    if (!membership) throw new AllianceServiceError("ALLIANCE_NOT_FOUND");
    const c = await tx.competition.findFirst({ where: { id: i.competitionId, allianceId: membership.allianceId }, include: { entries: true } });
    if (!c) throw new AllianceServiceError("COMPETITION_NOT_FOUND");
    if (c.status !== "REGISTRATION") throw new AllianceServiceError("COMPETITION_NOT_OPEN");
    if (c.entries.some(e => e.clubId === user.club!.id)) return { joined: true, replayed: true, teams: c.entries.length };
    if (c.entries.length >= c.maxTeams) throw new AllianceServiceError("COMPETITION_FULL");
    await tx.competitionEntry.create({ data: { competitionId: c.id, clubId: user.club!.id } });
    return { joined: true, replayed: false, teams: c.entries.length + 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function startAllianceChampionship(i: { telegramUserId: string; telegramGroupId: string; competitionId: string }) {
  const { user, group } = await prisma.$transaction(tx => manager(tx, i.telegramUserId, i.telegramGroupId));
  const membership = await prisma.allianceGroup.findUnique({ where: { groupId: group.id } });
  if (!membership) throw new AllianceServiceError("ALLIANCE_NOT_FOUND");
  const competition = await prisma.competition.findFirst({ where: { id: i.competitionId, allianceId: membership.allianceId }, select: { id: true, createdByClubId: true } });
  if (!competition) throw new AllianceServiceError("COMPETITION_NOT_FOUND");
  if (competition.createdByClubId !== user.club!.id) throw new AllianceServiceError("ONLY_CREATOR_CAN_START");
  return startLeague(user.id, competition.id);
}

export async function startAllianceSeason(i: { telegramUserId: string; telegramGroupId: string; durationDays: number }) {
  return prisma.$transaction(async tx => {
    const { group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id }, include: { alliance: { include: { seasons: { orderBy: { number: "desc" }, take: 1 } } } } });
    if (!membership || membership.role !== "FOUNDER") throw new AllianceServiceError("ALLIANCE_FOUNDER_REQUIRED");
    const active = membership.alliance.seasons[0];
    if (active?.status === "ACTIVE") throw new AllianceServiceError("SEASON_ALREADY_ACTIVE");
    const number = (active?.number ?? 0) + 1;
    const season = await tx.allianceSeason.create({ data: { allianceId: membership.allianceId, number, endsAt: new Date(Date.now() + i.durationDays * 86400000) } });
    return { season, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function closeAllianceSeason(i: { telegramUserId: string; telegramGroupId: string }) {
  return prisma.$transaction(async tx => {
    const { group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id } });
    if (!membership || membership.role !== "FOUNDER") throw new AllianceServiceError("ALLIANCE_FOUNDER_REQUIRED");
    const season = await tx.allianceSeason.findFirst({ where: { allianceId: membership.allianceId }, orderBy: { number: "desc" } });
    if (!season) throw new AllianceServiceError("NO_ACTIVE_SEASON");
    if (season.status === "COMPLETED") return { season, standings: season.standings, replayed: true };
    if (season.status !== "ACTIVE") throw new AllianceServiceError("NO_ACTIVE_SEASON");
    const groups = await tx.allianceGroup.findMany({
      where: { allianceId: membership.allianceId },
      include: { group: { select: { id: true, title: true, points: true } } },
    });
    const ranked = groups
      .map(x => ({ groupId: x.group.id, group: x.group.title, points: x.group.points.toString() }))
      .sort((a, b) => BigInt(b.points) > BigInt(a.points) ? 1 : BigInt(b.points) < BigInt(a.points) ? -1 : a.group.localeCompare(b.group));
    const standings = ranked.map((x, index) => ({ rank: index + 1, group: x.group, points: x.points }));
    const updated = await tx.allianceSeason.update({ where: { id: season.id, status: "ACTIVE" }, data: { status: "COMPLETED", closedAt: new Date(), standings } });
    const prize = await tx.alliance.findUniqueOrThrow({ where: { id: membership.allianceId }, select: { treasuryPoints: true } });
    const winner = ranked[0];
    if (winner && prize.treasuryPoints > 0n) {
      const payoutKey = "alliance-season-payout:" + season.id;
      await tx.telegramGroup.update({ where: { id: winner.groupId }, data: { points: { increment: prize.treasuryPoints } } });
      await tx.alliance.update({ where: { id: membership.allianceId }, data: { treasuryPoints: 0n } });
      await tx.allianceLedger.create({ data: { allianceId: membership.allianceId, idempotencyKey: payoutKey, amount: -prize.treasuryPoints, source: "SEASON_CHAMPION_REWARD", description: "Season " + season.number + " champion payout to " + winner.group } });
      await tx.groupPointLedger.create({ data: { idempotencyKey: payoutKey, groupId: winner.groupId, amount: prize.treasuryPoints, source: "ADMIN_ADJUSTMENT", description: "Alliance season champion reward" } });
    }
    return { season: updated, standings, replayed: false, winner: winner?.group ?? null, prize: prize.treasuryPoints.toString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
