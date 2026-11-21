import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { MatchServiceError, startLeague } from "../game/match-service.js";
import { buildAllianceSeasonStandings, type AllianceSeasonLedgerEntry, type AllianceSeasonGroupInput } from "./alliance-security.js";

const ALLIANCE_DEFAULT_SEASON_DAYS = 30;
async function getAllianceSeasonDuration(tx: Prisma.TransactionClient) {
  const setting = await tx.gameSetting.findUnique({ where: { key: "alliances.defaultSeasonDurationDays" }, select: { value: true } });
  const value = typeof setting?.value === "number" ? setting.value : NaN;
  return Number.isSafeInteger(value) && value >= 7 && value <= 90 ? value : ALLIANCE_DEFAULT_SEASON_DAYS;
}

export class AllianceServiceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AllianceServiceError"; }
}

async function manager(tx: Prisma.TransactionClient, telegramId: string, telegramGroupId: string, _requireManager = true) {
  const user = await tx.user.findUnique({ where: { telegramId }, select: { id: true, club: { select: { id: true, name: true } } } });
  if (!user) throw new AllianceServiceError("ACCOUNT_NOT_FOUND");
  if (!user.club) throw new AllianceServiceError("CLUB_NOT_FOUND");
  const group = await tx.telegramGroup.findUnique({ where: { telegramId: telegramGroupId }, select: { id: true, telegramId: true, title: true, isActive: true, memberships: { where: { userId: user.id }, select: { role: true } } } });
  if (!group) throw new AllianceServiceError("GROUP_NOT_REGISTERED");
  if (!group.isActive) throw new AllianceServiceError("GROUP_INACTIVE");
  if (!group.memberships.length) throw new AllianceServiceError("NOT_GROUP_MEMBER");
  return { user, group };
}

async function audit(tx: Prisma.TransactionClient, input: { allianceId: string; actorTelegramId: string; groupTelegramId: string; action: string; metadata?: Prisma.InputJsonObject }) {
  await tx.allianceAuditLog.create({ data: { ...input, metadata: input.metadata ?? {} } });
}

function allianceReviewers() {
  return new Set((process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS ?? "").split(",").map(x => x.trim()).filter(x => /^\d{1,20}$/.test(x)));
}

async function payAllianceSeasonPrize(tx: Prisma.TransactionClient, allianceId: string, seasonId: string, seasonNumber: number, standings: Array<{ groupId: string; group: string; points: string }>) {
  const winner = standings[0];
  const alliance = await tx.alliance.findUniqueOrThrow({ where: { id: allianceId }, select: { treasuryPoints: true } });
  if (!winner || BigInt(winner.points) <= BigInt(0) || alliance.treasuryPoints <= BigInt(0)) return { winner: null, prize: "0" };
  const payoutKey = "alliance-season-payout:" + seasonId;
  const prior = await tx.allianceLedger.findUnique({ where: { idempotencyKey: payoutKey } });
  if (prior) return { winner: winner.group, prize: (-prior.amount).toString(), replayed: true };
  await tx.telegramGroup.update({ where: { id: winner.groupId }, data: { points: { increment: alliance.treasuryPoints } } });
  await tx.alliance.update({ where: { id: allianceId }, data: { treasuryPoints: 0n } });
  await tx.allianceLedger.create({ data: { allianceId, idempotencyKey: payoutKey, amount: -alliance.treasuryPoints, source: "SEASON_CHAMPION_REWARD", description: "Season " + seasonNumber + " champion payout to " + winner.group } });
  await tx.groupPointLedger.create({ data: { idempotencyKey: payoutKey, groupId: winner.groupId, amount: alliance.treasuryPoints, source: "ADMIN_ADJUSTMENT", description: "Alliance season champion reward" } });
  return { winner: winner.group, prize: alliance.treasuryPoints.toString(), replayed: false };
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
    await audit(tx, { allianceId: alliance.id, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "ALLIANCE_CREATED", metadata: { name: i.name } });
    return { alliance, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function inviteAllianceGroup(i: { telegramUserId: string; telegramGroupId: string; targetTelegramGroupId: string }) {
  return prisma.$transaction(async tx => {
    const { group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id }, include: { alliance: true } });
    if (!membership || membership.alliance.status !== "ACTIVE") throw new AllianceServiceError("ALLIANCE_NOT_FOUND");
    const target = await tx.telegramGroup.findUnique({ where: { telegramId: i.targetTelegramGroupId }, select: { id: true, telegramId: true, isActive: true } });
    if (!target) throw new AllianceServiceError("TARGET_GROUP_NOT_FOUND");
    if (!target.isActive) throw new AllianceServiceError("TARGET_GROUP_INACTIVE");
    if (target.id === group.id) throw new AllianceServiceError("CANNOT_INVITE_SELF");
    if (await tx.allianceGroup.findUnique({ where: { groupId: target.id } })) throw new AllianceServiceError("TARGET_ALREADY_IN_ALLIANCE");
    const invitation = await tx.allianceInvitation.upsert({
      where: { allianceId_groupId: { allianceId: membership.allianceId, groupId: target.id } },
      create: { allianceId: membership.allianceId, groupId: target.id, invitedByGroupId: group.id },
      update: { status: "PENDING", invitedByGroupId: group.id, respondedAt: null },
    });
    await audit(tx, { allianceId: membership.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "GROUP_INVITED", metadata: { targetGroupId: target.telegramId, invitationId: invitation.id } });
    return { invitation, alliance: { id: membership.alliance.id, name: membership.alliance.name } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


export async function contributeAllianceTreasury(i: { telegramUserId: string; telegramGroupId: string; amount: bigint; idempotencyKey: string }) {
  if (i.amount <= 0n || i.amount > 1000000000n) throw new AllianceServiceError("INVALID_CONTRIBUTION_AMOUNT");
  return prisma.$transaction(async tx => {
    const { user, group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id } });
    if (!membership) throw new AllianceServiceError("ALLIANCE_NOT_FOUND");
    const userIdForLedger = user.id;
    const old = await tx.allianceLedger.findUnique({ where: { idempotencyKey: i.idempotencyKey } });
    if (old) {
      const priorGroupEntry = await tx.groupPointLedger.findUnique({ where: { idempotencyKey: "alliance-contribution:" + i.idempotencyKey }, select: { groupId: true } });
      if (old.allianceId !== membership.allianceId || priorGroupEntry?.groupId !== group.id) throw new AllianceServiceError("IDEMPOTENCY_CONFLICT");
      return { contributed: true, replayed: true, treasuryPoints: (await tx.alliance.findUniqueOrThrow({where:{id:membership.allianceId},select:{treasuryPoints:true}})).treasuryPoints.toString() };
    }
    const activeSeason = await tx.allianceSeason.findFirst({ where: { allianceId: membership.allianceId, status: "ACTIVE" } });
    if (!activeSeason) throw new AllianceServiceError("SEASON_REVIEW_REQUIRED");
    const debited = await tx.telegramGroup.updateMany({ where: { id: group.id, points: { gte: i.amount } }, data: { points: { decrement: i.amount } } });
    if (!debited.count) throw new AllianceServiceError("INSUFFICIENT_GROUP_POINTS");
    const alliance = await tx.alliance.update({ where: { id: membership.allianceId }, data: { treasuryPoints: { increment: i.amount } }, select: { treasuryPoints: true } });
    await tx.allianceLedger.create({ data: { allianceId: membership.allianceId, idempotencyKey: i.idempotencyKey, amount: i.amount, source: "GROUP_CONTRIBUTION", description: "Contribution from Telegram group " + group.title } });
    await tx.groupPointLedger.create({ data: { idempotencyKey: "alliance-contribution:" + i.idempotencyKey, groupId: group.id, userId: userIdForLedger, amount: -i.amount, source: "ADMIN_ADJUSTMENT", description: "Contribution to alliance treasury" } });
    await audit(tx, { allianceId: membership.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "TREASURY_CONTRIBUTION", metadata: { amount: i.amount.toString(), idempotencyKey: i.idempotencyKey } });
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
    await audit(tx, { allianceId: invitation.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: i.accept ? "INVITATION_ACCEPTED" : "INVITATION_DECLINED", metadata: { invitationId: invitation.id } });
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
  const [groups, seasons, competitions, auditLogs] = await Promise.all([
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
    prisma.allianceAuditLog.findMany({ where: { allianceId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return {
    alliance: {
      id: membership.alliance.id,
      name: membership.alliance.name,
      description: membership.alliance.description,
      treasuryPoints: membership.alliance.treasuryPoints.toString(),
      groups: groups.map(x => ({ title: x.group.title, telegramGroupId: x.group.telegramId, memberCount: x.group.memberCount, points: x.group.points.toString(), role: x.role })),
      canReview: membership.role === "FOUNDER" && allianceReviewers().has(telegramUserId),
      seasons,
      auditLogs: auditLogs.map(x => ({ id: x.id, actorTelegramId: x.actorTelegramId, groupTelegramId: x.groupTelegramId, action: x.action, metadata: x.metadata, createdAt: x.createdAt.toISOString() })),
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
    if (!season) throw new AllianceServiceError("SEASON_REVIEW_REQUIRED");
    const competition = await tx.competition.create({ data: { idempotencyKey: i.idempotencyKey, name: i.name, season: season?.number ?? 1, format: "LEAGUE", maxTeams: i.maxTeams, createdByClubId: clubId, allianceId: membership.allianceId, ...(season ? { allianceSeasonId: season.id } : {}), entries: { create: { clubId } } } });
    await audit(tx, { allianceId: membership.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "CHAMPIONSHIP_CREATED", metadata: { competitionId: competition.id, name: competition.name, maxTeams: competition.maxTeams } });
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
    await audit(tx, { allianceId: membership.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "CHAMPIONSHIP_JOINED", metadata: { competitionId: c.id, clubId: user.club!.id } });
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
  try {
    const result = await startLeague(user.id, competition.id);
    await prisma.allianceAuditLog.create({ data: { allianceId: membership.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "CHAMPIONSHIP_STARTED", metadata: { competitionId: competition.id } } });
    return result;
  } catch (error) { if (error instanceof MatchServiceError) throw new AllianceServiceError(error.code); throw error; }
}

export async function startAllianceSeason(i: { telegramUserId: string; telegramGroupId: string; durationDays?: number }) {
  return prisma.$transaction(async tx => {
    const durationDays = i.durationDays ?? await getAllianceSeasonDuration(tx);
    if (!Number.isInteger(durationDays) || durationDays < 7 || durationDays > 90) throw new AllianceServiceError("INVALID_SEASON_DURATION");
    const { group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id }, include: { alliance: { include: { seasons: { orderBy: { number: "desc" }, take: 1 } } } } });
    if (!membership || membership.role !== "FOUNDER") throw new AllianceServiceError("ALLIANCE_FOUNDER_REQUIRED");
    const active = membership.alliance.seasons[0];
    if (membership.alliance.status !== "ACTIVE") throw new AllianceServiceError("ALLIANCE_INACTIVE");
    if (active?.status === "ACTIVE") throw new AllianceServiceError("SEASON_ALREADY_ACTIVE");
    if (active?.reviewStatus === "FLAGGED") throw new AllianceServiceError("SEASON_REVIEW_REQUIRED");
    const number = (active?.number ?? 0) + 1;
    const season = await tx.allianceSeason.create({ data: { allianceId: membership.allianceId, number, startsAt: new Date(), endsAt: new Date(Date.now() + durationDays * 86400000) } });
    await audit(tx, { allianceId: membership.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "SEASON_STARTED", metadata: { seasonId: season.id, number, durationDays } });
    return { season, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function closeAllianceSeason(i: { telegramUserId: string; telegramGroupId: string }) {
  const result = await prisma.$transaction(async tx => {
    const { group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id } });
    if (!membership || membership.role !== "FOUNDER") throw new AllianceServiceError("ALLIANCE_FOUNDER_REQUIRED");
    const season = await tx.allianceSeason.findFirst({ where: { allianceId: membership.allianceId }, orderBy: { number: "desc" } });
    if (!season) throw new AllianceServiceError("NO_ACTIVE_SEASON");
    if (season.status === "COMPLETED") return { season, standings: season.standings, replayed: true, reviewStatus: season.reviewStatus, securityFlags: (season.securityFlags ?? []) as unknown as Array<{ code: string; group?: string; sharePercent?: number; groups?: Array<{ group: string }> }> };
    if (season.status !== "ACTIVE") throw new AllianceServiceError("NO_ACTIVE_SEASON");
    const now = new Date();
    if (season.endsAt > now) throw new AllianceServiceError("SEASON_NOT_ENDED");
    const memberships = await tx.allianceGroup.findMany({
      where: { allianceId: membership.allianceId },
      include: { group: { select: { id: true, title: true } } },
    });
    const ledger = await tx.groupPointLedger.findMany({
      where: {
        groupId: { in: memberships.map(x => x.groupId) },
        createdAt: { gte: season.startsAt, lt: season.endsAt },
        source: { in: ["DAILY_ACTIVITY", "GAME_ACTIVITY", "CHALLENGE_REWARD", "LEAGUE_REWARD"] },
      },
      select: { groupId: true, userId: true, amount: true, source: true, createdAt: true },
    });
    const groups: AllianceSeasonGroupInput[] = memberships.map(x => ({ groupId: x.groupId, group: x.group.title, joinedAt: x.joinedAt }));
    const entries: AllianceSeasonLedgerEntry[] = ledger.map(x => ({ groupId: x.groupId, userId: x.userId, amount: x.amount, source: x.source, createdAt: x.createdAt }));
    const result = buildAllianceSeasonStandings(groups, entries, season.startsAt, season.endsAt);
    const reviewStatus = result.securityFlags.length ? "FLAGGED" : "APPROVED";
    const changed = await tx.allianceSeason.updateMany({
      where: { id: season.id, status: "ACTIVE" },
      data: { status: "COMPLETED", closedAt: now, standings: result.standings, securityFlags: result.securityFlags as unknown as Prisma.InputJsonValue, reviewStatus },
    });
    if (!changed.count) throw new AllianceServiceError("SEASON_ALREADY_SETTLED");
    await audit(tx, { allianceId: membership.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "SEASON_CLOSED", metadata: { seasonId: season.id, reviewStatus, securityFlags: result.securityFlags.length } });
    let payout = { winner: null as string | null, prize: "0" };
    if (reviewStatus === "APPROVED") {
      const paid = await payAllianceSeasonPrize(tx, membership.allianceId, season.id, season.number, result.standings);
      payout = { winner: paid.winner, prize: paid.prize };
      if (paid.prize !== "0") await audit(tx, { allianceId: membership.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "SEASON_PRIZE_PAID", metadata: { seasonId: season.id, winner: paid.winner, prize: paid.prize } });
    }
    const updated = await tx.allianceSeason.findUniqueOrThrow({ where: { id: season.id } });
    return { season: updated, standings: result.standings, replayed: false, reviewStatus, securityFlags: result.securityFlags, ...payout };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.replayed && result.reviewStatus === "FLAGGED" && process.env.TELEGRAM_BOT_TOKEN) {
    const alert = "هشدار امنیتی Football Empire\nجایزه فصل به دلیل الگوی مشکوک مسدود شد.\n" +
      (result.securityFlags ?? []).map((flag: { code: string; group?: string; sharePercent?: number; groups?: Array<{ group: string }> }) =>
        flag.code === "SINGLE_MEMBER_CONCENTRATION" ? "تمرکز امتیاز در " + flag.group + ": " + flag.sharePercent + "%" :
        "هم‌پوشانی امتیاز بین گروه‌ها: " + (flag.groups ?? []).map(group => group.group).join("، ")
      ).join("\n") + "\nبرای بررسی از /alliance-season-review SEASON_ID approve|reject استفاده کنید.";
    try {
      const response = await fetch("https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: i.telegramGroupId, text: alert }), signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) console.warn("Alliance security alert delivery failed:", response.status);
    } catch (error) { console.warn("Alliance security alert delivery failed:", error); }
  }
  return result;
}

export async function reviewAllianceSeason(i: { telegramUserId: string; telegramGroupId: string; seasonId: string; decision: "APPROVE" | "REJECT" }) {
  return prisma.$transaction(async tx => {
    const { user, group } = await manager(tx, i.telegramUserId, i.telegramGroupId);
    const membership = await tx.allianceGroup.findUnique({ where: { groupId: group.id } });
    if (!membership || membership.role !== "FOUNDER") throw new AllianceServiceError("ALLIANCE_FOUNDER_REQUIRED");
    if (!allianceReviewers().has(i.telegramUserId)) throw new AllianceServiceError("ALLIANCE_REVIEWER_REQUIRED");
    const season = await tx.allianceSeason.findFirst({ where: { id: i.seasonId, allianceId: membership.allianceId } });
    if (!season) throw new AllianceServiceError("SEASON_NOT_FOUND");
    if (season.reviewStatus === "APPROVED" || season.reviewStatus === "REJECTED") return { reviewStatus: season.reviewStatus, replayed: true, prize: "0" };
    if (season.status !== "COMPLETED" || season.reviewStatus !== "FLAGGED") throw new AllianceServiceError("SEASON_NOT_FLAGGED");
    const updated = await tx.allianceSeason.update({ where: { id: season.id }, data: { reviewStatus: i.decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedAt: new Date(), reviewedByUserId: user.id } });
    let payout = { winner: null as string | null, prize: "0" };
    if (i.decision === "APPROVE") {
      const standings = (season.standings ?? []) as unknown as Array<{ groupId: string; group: string; points: string }>;
      const paid = await payAllianceSeasonPrize(tx, membership.allianceId, season.id, season.number, standings);
      payout = { winner: paid.winner, prize: paid.prize };
    }
    await audit(tx, { allianceId: membership.allianceId, actorTelegramId: i.telegramUserId, groupTelegramId: group.telegramId, action: "SEASON_SECURITY_REVIEW", metadata: { seasonId: season.id, decision: i.decision, prize: payout.prize } });
    return { season: updated, reviewStatus: updated.reviewStatus, replayed: false, ...payout };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


export async function adminCloseAllianceSeasonInTransaction(
  tx: Prisma.TransactionClient,
  input: { telegramUserId: string; seasonId: string },
) {
  const season = await tx.allianceSeason.findUnique({ where: { id: input.seasonId } });
  if (!season) throw new AllianceServiceError("SEASON_NOT_FOUND");
  if (season.status === "COMPLETED") return { season, standings: season.standings, replayed: true, reviewStatus: season.reviewStatus };
  if (season.status !== "ACTIVE") throw new AllianceServiceError("NO_ACTIVE_SEASON");
  const now = new Date();
  if (season.endsAt > now) throw new AllianceServiceError("SEASON_NOT_ENDED");
  const founder = await tx.allianceGroup.findFirst({
    where: { allianceId: season.allianceId, role: "FOUNDER" },
    include: { group: { select: { id: true, title: true, telegramId: true } } },
  });
  if (!founder) throw new AllianceServiceError("ALLIANCE_FOUNDER_REQUIRED");
  const memberships = await tx.allianceGroup.findMany({
    where: { allianceId: season.allianceId },
    include: { group: { select: { id: true, title: true } } },
  });
  const ledger = await tx.groupPointLedger.findMany({
    where: {
      groupId: { in: memberships.map(x => x.groupId) },
      createdAt: { gte: season.startsAt, lt: season.endsAt },
      source: { in: ["DAILY_ACTIVITY", "GAME_ACTIVITY", "CHALLENGE_REWARD", "LEAGUE_REWARD"] },
    },
    select: { groupId: true, userId: true, amount: true, source: true, createdAt: true },
  });
  const groups: AllianceSeasonGroupInput[] = memberships.map(x => ({ groupId: x.groupId, group: x.group.title, joinedAt: x.joinedAt }));
  const entries: AllianceSeasonLedgerEntry[] = ledger.map(x => ({ groupId: x.groupId, userId: x.userId, amount: x.amount, source: x.source, createdAt: x.createdAt }));
  const calculated = buildAllianceSeasonStandings(groups, entries, season.startsAt, season.endsAt);
  const reviewStatus = calculated.securityFlags.length ? "FLAGGED" : "APPROVED";
  const changed = await tx.allianceSeason.updateMany({
    where: { id: season.id, status: "ACTIVE" },
    data: {
      status: "COMPLETED", closedAt: now, standings: calculated.standings,
      securityFlags: calculated.securityFlags as unknown as Prisma.InputJsonValue, reviewStatus,
    },
  });
  if (!changed.count) throw new AllianceServiceError("SEASON_ALREADY_SETTLED");
  await audit(tx, {
    allianceId: season.allianceId, actorTelegramId: input.telegramUserId,
    groupTelegramId: founder.group.telegramId, action: "ADMIN_SEASON_CLOSED",
    metadata: { seasonId: season.id, reviewStatus, securityFlags: calculated.securityFlags.length },
  });
  let payout = { winner: null as string | null, prize: "0" };
  if (reviewStatus === "APPROVED") {
    const paid = await payAllianceSeasonPrize(tx, season.allianceId, season.id, season.number, calculated.standings);
    payout = { winner: paid.winner, prize: paid.prize };
    if (paid.prize !== "0") await audit(tx, {
      allianceId: season.allianceId, actorTelegramId: input.telegramUserId,
      groupTelegramId: founder.group.telegramId, action: "SEASON_PRIZE_PAID",
      metadata: { seasonId: season.id, winner: paid.winner, prize: paid.prize },
    });
  }
  const updated = await tx.allianceSeason.findUniqueOrThrow({ where: { id: season.id } });
  return { season: updated, standings: calculated.standings, replayed: false, reviewStatus, securityFlags: calculated.securityFlags, ...payout, alertGroupTelegramId: founder.group.telegramId };
}

export async function adminReviewAllianceSeasonInTransaction(
  tx: Prisma.TransactionClient,
  input: { telegramUserId: string; telegramUserDbId: string; seasonId: string; decision: "APPROVE" | "REJECT" },
) {
  const season = await tx.allianceSeason.findUnique({ where: { id: input.seasonId } });
  if (!season) throw new AllianceServiceError("SEASON_NOT_FOUND");
  if (season.reviewStatus === "APPROVED" || season.reviewStatus === "REJECTED") return { season, replayed: true, prize: "0" };
  if (season.status !== "COMPLETED" || season.reviewStatus !== "FLAGGED") throw new AllianceServiceError("SEASON_NOT_FLAGGED");
  const founder = await tx.allianceGroup.findFirst({
    where: { allianceId: season.allianceId, role: "FOUNDER" },
    include: { group: { select: { telegramId: true } } },
  });
  if (!founder) throw new AllianceServiceError("ALLIANCE_FOUNDER_REQUIRED");
  const updated = await tx.allianceSeason.update({
    where: { id: season.id },
    data: { reviewStatus: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedAt: new Date(), reviewedByUserId: input.telegramUserDbId },
  });
  let payout = { winner: null as string | null, prize: "0" };
  if (input.decision === "APPROVE") {
    const standings = (season.standings ?? []) as unknown as Array<{ groupId: string; group: string; points: string }>;
    const paid = await payAllianceSeasonPrize(tx, season.allianceId, season.id, season.number, standings);
    payout = { winner: paid.winner, prize: paid.prize };
  }
  await audit(tx, {
    allianceId: season.allianceId, actorTelegramId: input.telegramUserId,
    groupTelegramId: founder.group.telegramId, action: "ADMIN_SEASON_REVIEWED",
    metadata: { seasonId: season.id, decision: input.decision, prize: payout.prize },
  });
  return { season: updated, replayed: false, ...payout };
}


export async function adminStartAllianceSeasonInTransaction(
  tx: Prisma.TransactionClient,
  input: { telegramUserId: string; allianceId: string; durationDays?: number },
) {
  const durationDays = input.durationDays ?? await getAllianceSeasonDuration(tx);
  if (!Number.isInteger(durationDays) || durationDays < 7 || durationDays > 90) throw new AllianceServiceError("INVALID_SEASON_DURATION");
  const alliance = await tx.alliance.findUnique({ where: { id: input.allianceId }, select: { id: true, status: true } });
  if (!alliance) throw new AllianceServiceError("ALLIANCE_NOT_FOUND");
  if (alliance.status !== "ACTIVE") throw new AllianceServiceError("ALLIANCE_INACTIVE");
  const founder = await tx.allianceGroup.findFirst({
    where: { allianceId: alliance.id, role: "FOUNDER" },
    include: { group: { select: { telegramId: true } } },
  });
  if (!founder) throw new AllianceServiceError("ALLIANCE_FOUNDER_REQUIRED");
  const previous = await tx.allianceSeason.findFirst({ where: { allianceId: alliance.id }, orderBy: { number: "desc" } });
  if (previous?.status === "ACTIVE") throw new AllianceServiceError("SEASON_ALREADY_ACTIVE");
  if (previous?.reviewStatus === "FLAGGED") throw new AllianceServiceError("SEASON_REVIEW_REQUIRED");
  const number = (previous?.number ?? 0) + 1;
  const now = new Date();
  const season = await tx.allianceSeason.create({
    data: { allianceId: alliance.id, number, startsAt: now, endsAt: new Date(now.getTime() + durationDays * 86400000) },
  });
  await audit(tx, {
    allianceId: alliance.id, actorTelegramId: input.telegramUserId, groupTelegramId: founder.group.telegramId,
    action: "ADMIN_SEASON_STARTED", metadata: { seasonId: season.id, number, durationDays },
  });
  return { season, replayed: false };
}
