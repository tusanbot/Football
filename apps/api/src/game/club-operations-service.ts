import { randomInt, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  calculateAcademyScoutCost,
  calculateCoachUpgradeCost,
  calculateDailyOperatingCost,
  calculateFacilityUpgradeCost,
  calculateProspectRecruitmentCost,
  calculateStadiumCapacity,
  COACH_CANDIDATES,
  getSponsorOffers,
  type FacilityType,
} from "@football/domain";
import { prisma } from "../db.js";
import { settleClubDailyState } from "../players/player-development-service.js";

const DAY_MS = 86_400_000;
const POSITIONS = ["GK", "RB", "LB", "CB", "CDM", "CM", "CAM", "RW", "LW", "ST"] as const;
const FIRST_NAMES = ["Arman", "Kian", "Navid", "Sina", "Rayan", "Arian", "Yasin", "Mahan", "Nima", "Parsa", "Darian", "Omid"];
const LAST_NAMES = ["Rahimi", "Karimi", "Ahmadi", "Moradi", "Jafari", "Hosseini", "Azizi", "Ebrahimi", "Nouri", "Rezaei"];
const NATIONALITIES = ["IR", "DE", "FR", "BR", "AR", "ES", "TR", "NL"];

export class ClubOperationsError extends Error {
  constructor(public readonly code: string, public readonly details?: Record<string, string>) {
    super(code);
    this.name = "ClubOperationsError";
  }
}

function utcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
function dayDiff(later: Date, earlier: Date) {
  return Math.max(0, Math.floor((utcDay(later).getTime() - utcDay(earlier).getTime()) / DAY_MS));
}
function assertKey(key: string) {
  if (!/^[A-Za-z0-9:_-]{12,128}$/.test(key)) throw new ClubOperationsError("INVALID_IDEMPOTENCY_KEY");
}
function randomItem<T>(items: readonly T[]): T { return items[randomInt(0, items.length)]!; }
function prospectAttributes(position: string, overall: number) {
  const roll = () => Math.max(20, Math.min(90, overall + randomInt(-12, 13)));
  return {
    pace: roll(), shooting: roll(), passing: roll(), dribbling: roll(),
    defending: roll(), physical: roll(), goalkeeping: position === "GK" ? Math.min(95, overall + randomInt(0, 16)) : randomInt(20, 45),
  };
}
async function replayCheck(tx: Prisma.TransactionClient, userId: string, clubId: string, key: string, reason: string) {
  const previous = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: `club-op:${key}` } });
  if (!previous) return false;
  if (previous.userId !== userId || previous.reason !== reason || previous.referenceId !== clubId) {
    throw new ClubOperationsError("IDEMPOTENCY_CONFLICT");
  }
  return true;
}
async function debitCash(
  tx: Prisma.TransactionClient, userId: string, clubId: string, amount: bigint,
  key: string, reason: string, category: string, description: string, now: Date,
) {
  if (amount <= 0n) throw new ClubOperationsError("INVALID_AMOUNT");
  const wallet = await tx.wallet.findUnique({ where: { userId_asset: { userId, asset: "CASH" } } });
  if (!wallet) throw new ClubOperationsError("WALLET_NOT_FOUND");
  if (wallet.balance < amount) throw new ClubOperationsError("INSUFFICIENT_CASH", { required: amount.toString(), available: wallet.balance.toString() });
  const changed = await tx.wallet.updateMany({
    where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
    data: { balance: { decrement: amount }, version: { increment: 1 } },
  });
  if (changed.count !== 1) throw new ClubOperationsError("CONCURRENT_MODIFICATION");
  await tx.ledgerTransaction.create({
    data: {
      idempotencyKey: `club-op:${key}`, userId, asset: "CASH", direction: "DEBIT",
      amount, reason, referenceType: "CLUB_OPERATIONS", referenceId: clubId,
    },
  });
  await tx.clubFinanceEntry.create({
    data: {
      idempotencyKey: `club-finance:${key}`, clubId, category, direction: "DEBIT",
      amount, description, occurredAt: now,
    },
  });
}
async function creditCash(
  tx: Prisma.TransactionClient, userId: string, clubId: string, amount: bigint,
  key: string, reason: string, category: string, description: string, now: Date,
) {
  if (amount <= 0n) return;
  const wallet = await tx.wallet.findUnique({ where: { userId_asset: { userId, asset: "CASH" } } });
  if (!wallet) throw new ClubOperationsError("WALLET_NOT_FOUND");
  const changed = await tx.wallet.updateMany({
    where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
    data: { balance: { increment: amount }, version: { increment: 1 } },
  });
  if (changed.count !== 1) throw new ClubOperationsError("CONCURRENT_MODIFICATION");
  await tx.ledgerTransaction.create({
    data: {
      idempotencyKey: `club-op:${key}`, userId, asset: "CASH", direction: "CREDIT",
      amount, reason, referenceType: "CLUB_OPERATIONS", referenceId: clubId,
    },
  });
  await tx.clubFinanceEntry.create({
    data: {
      idempotencyKey: `club-finance:${key}`, clubId, category, direction: "CREDIT",
      amount, description, occurredAt: now,
    },
  });
}

export async function settleClubEconomy(userId: string, now = new Date()) {
  const today = utcDay(now);
  try {
    return await prisma.$transaction(async (tx) => {
      const club = await tx.club.findUnique({
        where: { ownerId: userId },
        select: {
          id: true, stadiumLevel: true, ticketPrice: true, trainingGroundLevel: true, academyLevel: true,
          lastEconomyTickAt: true, operatingArrears: true,
          owner: { select: { id: true } },
          sponsors: { where: { status: "ACTIVE" }, select: { id: true, dailyIncome: true, startedAt: true, endsAt: true } },
        },
      });
      if (!club) throw new ClubOperationsError("CLUB_NOT_FOUND");
      const elapsedDays = dayDiff(today, club.lastEconomyTickAt);
      if (elapsedDays === 0) return { elapsedDays: 0, sponsorIncome: "0", operatingCost: "0", paid: "0", arrears: club.operatingArrears.toString() };

      const firstAccrualDay = new Date(utcDay(club.lastEconomyTickAt).getTime() + DAY_MS);
      let sponsorIncome = 0n;
      for (const sponsor of club.sponsors) {
        const activeFrom = sponsor.startedAt > firstAccrualDay ? utcDay(sponsor.startedAt) : firstAccrualDay;
        const activeUntil = sponsor.endsAt < today ? utcDay(sponsor.endsAt) : today;
        const activeDays = activeUntil >= activeFrom ? dayDiff(activeUntil, activeFrom) + 1 : 0;
        if (activeDays > 0) sponsorIncome += sponsor.dailyIncome * BigInt(activeDays);
        if (sponsor.endsAt <= now) await tx.sponsorContract.update({ where: { id: sponsor.id }, data: { status: "EXPIRED" } });
      }
      const dailyCost = calculateDailyOperatingCost(club);
      const operatingCost = dailyCost * BigInt(elapsedDays) + club.operatingArrears;
      const wallet = await tx.wallet.findUnique({ where: { userId_asset: { userId, asset: "CASH" } } });
      if (!wallet) throw new ClubOperationsError("WALLET_NOT_FOUND");
      const available = wallet.balance + sponsorIncome;
      const paid = available < operatingCost ? available : operatingCost;
      const arrears = operatingCost - paid;
      const nextBalance = available - paid;
      if (sponsorIncome > 0n || paid > 0n) {
        const changed = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
          data: { balance: nextBalance, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ClubOperationsError("CONCURRENT_MODIFICATION");
      }
      if (sponsorIncome > 0n) {
        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: `club-economy:${club.id}:${today.toISOString().slice(0, 10)}:sponsor`,
            userId, asset: "CASH", direction: "CREDIT", amount: sponsorIncome,
            reason: "SPONSOR_DAILY_INCOME", referenceType: "CLUB", referenceId: club.id,
          },
        });
        await tx.clubFinanceEntry.create({
          data: {
            idempotencyKey: `club-finance-daily:${club.id}:${today.toISOString().slice(0, 10)}:sponsor`,
            clubId: club.id, category: "SPONSOR_INCOME", direction: "CREDIT",
            amount: sponsorIncome, description: `Sponsor income for ${elapsedDays} game day(s)`, occurredAt: now,
          },
        });
      }
      if (paid > 0n) {
        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: `club-economy:${club.id}:${today.toISOString().slice(0, 10)}:maintenance`,
            userId, asset: "CASH", direction: "DEBIT", amount: paid,
            reason: "CLUB_FACILITY_MAINTENANCE", referenceType: "CLUB", referenceId: club.id,
          },
        });
      }
      if (operatingCost > 0n) {
        await tx.clubFinanceEntry.create({
          data: {
            idempotencyKey: `club-finance-daily:${club.id}:${today.toISOString().slice(0, 10)}:maintenance`,
            clubId: club.id, category: "FACILITY_MAINTENANCE", direction: "DEBIT",
            amount: operatingCost, description: `Facility maintenance accrued; paid ${paid}`, occurredAt: now,
          },
        });
      }
      await tx.clubEconomyTick.create({
        data: { clubId: club.id, gameDate: today, elapsedDays, income: sponsorIncome, expenses: operatingCost, paid, arrears },
      });
      await tx.club.update({
        where: { id: club.id },
        data: { lastEconomyTickAt: today, operatingArrears: arrears },
      });
      return {
        elapsedDays, sponsorIncome: sponsorIncome.toString(), operatingCost: operatingCost.toString(),
        paid: paid.toString(), arrears: arrears.toString(),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ClubOperationsError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      const club = await prisma.club.findUnique({ where: { ownerId: userId }, select: { operatingArrears: true } });
      return { elapsedDays: 0, sponsorIncome: "0", operatingCost: "0", paid: "0", arrears: club?.operatingArrears.toString() ?? "0" };
    }
    throw error;
  }
}

export async function getClubOperations(userId: string, now = new Date()) {
  await settleClubDailyState(userId, now);
  const settlement = await settleClubEconomy(userId, now);
  const club = await prisma.club.findUnique({
    where: { ownerId: userId },
    include: {
      coach: true,
      sponsors: { orderBy: { createdAt: "desc" }, take: 5 },
      academyProspects: { where: { status: "AVAILABLE" }, orderBy: { createdAt: "desc" }, take: 12 },
      financeEntries: { orderBy: { occurredAt: "desc" }, take: 20 },
    },
  });
  if (!club) throw new ClubOperationsError("CLUB_NOT_FOUND");
  const [wallet, coachOffers] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId_asset: { userId, asset: "CASH" } }, select: { balance: true } }),
    Promise.resolve(COACH_CANDIDATES.map((candidate) => ({
      id: candidate.id, name: candidate.name, signingFee: candidate.signingFee.toString(),
      weeklySalary: candidate.weeklySalary.toString(), trainingSkill: candidate.trainingSkill,
      recoverySkill: candidate.recoverySkill, medicalSkill: candidate.medicalSkill,
    }))),
  ]);
  const activeSponsor = club.sponsors.find((sponsor) => sponsor.status === "ACTIVE" && sponsor.endsAt > now) ?? null;
  return {
    club: {
      id: club.id, name: club.name, level: club.level, reputation: club.reputation,
      stadiumLevel: club.stadiumLevel, stadiumCapacity: calculateStadiumCapacity(club.stadiumLevel), ticketPrice: club.ticketPrice.toString(),
      trainingGroundLevel: club.trainingGroundLevel, academyLevel: club.academyLevel,
      dailyMaintenance: calculateDailyOperatingCost(club).toString(),
      operatingArrears: club.operatingArrears.toString(),
      coach: club.coach ? {
        id: club.coach.id, name: club.coach.name, level: club.coach.level,
        trainingSkill: club.coach.trainingSkill, recoverySkill: club.coach.recoverySkill,
        medicalSkill: club.coach.medicalSkill, weeklySalary: club.coach.weeklySalary.toString(),
      } : null,
      activeSponsor: activeSponsor ? {
        id: activeSponsor.id, partnerName: activeSponsor.partnerName, tier: activeSponsor.tier,
        dailyIncome: activeSponsor.dailyIncome.toString(), endsAt: activeSponsor.endsAt.toISOString(),
      } : null,
      sponsorOffers: getSponsorOffers(club.level, club.reputation).map((offer) => ({
        ...offer, dailyIncome: offer.dailyIncome.toString(), signingBonus: offer.signingBonus.toString(),
      })),
      coachOffers,
      prospects: club.academyProspects.map((prospect) => ({
        ...prospect, recruitmentCost: prospect.recruitmentCost.toString(),
      })),
      financeEntries: club.financeEntries.map((entry) => ({
        ...entry, amount: entry.amount.toString(), occurredAt: entry.occurredAt.toISOString(),
      })),
      cashBalance: wallet?.balance.toString() ?? "0",
      settlement,
    },
  };
}

export async function upgradeClubFacility(
  userId: string, facility: FacilityType, idempotencyKey: string, now = new Date(),
) {
  assertKey(idempotencyKey);
  await settleClubDailyState(userId, now);
  await settleClubEconomy(userId, now);
  const reason = "CLUB_FACILITY_UPGRADE";
  return prisma.$transaction(async (tx) => {
    const club = await tx.club.findUnique({ where: { ownerId: userId } });
    if (!club) throw new ClubOperationsError("CLUB_NOT_FOUND");
    if (await replayCheck(tx, userId, club.id, idempotencyKey, reason)) return { facility, replayed: true };
    const currentLevel = facility === "STADIUM" ? club.stadiumLevel : facility === "TRAINING_GROUND" ? club.trainingGroundLevel : club.academyLevel;
    if (currentLevel >= 10) throw new ClubOperationsError("FACILITY_MAX_LEVEL");
    const cost = calculateFacilityUpgradeCost(facility, currentLevel);
    await debitCash(tx, userId, club.id, cost, idempotencyKey, reason, "FACILITY_UPGRADE", `${facility} upgraded to level ${currentLevel + 1}`, now);
    const where = facility === "STADIUM" ? { id: club.id, stadiumLevel: currentLevel }
      : facility === "TRAINING_GROUND" ? { id: club.id, trainingGroundLevel: currentLevel }
      : { id: club.id, academyLevel: currentLevel };
    const data = facility === "STADIUM" ? { stadiumLevel: { increment: 1 } }
      : facility === "TRAINING_GROUND" ? { trainingGroundLevel: { increment: 1 } }
      : { academyLevel: { increment: 1 } };
    const updated = await tx.club.updateMany({ where, data });
    if (updated.count !== 1) throw new ClubOperationsError("CONCURRENT_MODIFICATION");
    return { facility, level: currentLevel + 1, cost: cost.toString(), replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function scoutAcademy(userId: string, idempotencyKey: string, now = new Date()) {
  assertKey(idempotencyKey);
  await settleClubDailyState(userId, now);
  await settleClubEconomy(userId, now);
  const reason = "ACADEMY_SCOUTING";
  return prisma.$transaction(async (tx) => {
    const club = await tx.club.findUnique({ where: { ownerId: userId } });
    if (!club) throw new ClubOperationsError("CLUB_NOT_FOUND");
    if (await replayCheck(tx, userId, club.id, idempotencyKey, reason)) return { prospects: [], replayed: true };
    if (club.academyLevel < 1) throw new ClubOperationsError("ACADEMY_NOT_BUILT");
    const cost = calculateAcademyScoutCost(club.academyLevel);
    await debitCash(tx, userId, club.id, cost, idempotencyKey, reason, "ACADEMY_SCOUTING", "Academy scouting network", now);
    const prospects = Array.from({ length: 3 }, () => {
      const age = randomInt(16, 19);
      const overall = randomInt(34, 53) + Math.min(8, club.academyLevel);
      const potential = Math.min(92, overall + randomInt(12, 31) + club.academyLevel);
      const position = randomItem(POSITIONS);
      const attributes = prospectAttributes(position, overall);
      return {
        id: randomUUID(), clubId: club.id, firstName: randomItem(FIRST_NAMES),
        lastName: randomItem(LAST_NAMES), nationality: randomItem(NATIONALITIES),
        age, position, overall, potential, attributes,
        recruitmentCost: calculateProspectRecruitmentCost(overall, potential, club.academyLevel),
      };
    });
    await tx.academyProspect.createMany({ data: prospects });
    return { prospects: prospects.map((prospect) => ({
      id: prospect.id, firstName: prospect.firstName, lastName: prospect.lastName,
      age: prospect.age, position: prospect.position, overall: prospect.overall,
      potential: prospect.potential, recruitmentCost: prospect.recruitmentCost.toString(),
    })), scoutingCost: cost.toString(), replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function recruitAcademyProspect(userId: string, prospectId: string, idempotencyKey: string, now = new Date()) {
  assertKey(idempotencyKey);
  await settleClubDailyState(userId, now);
  await settleClubEconomy(userId, now);
  const reason = "ACADEMY_PROSPECT_RECRUITMENT";
  return prisma.$transaction(async (tx) => {
    const club = await tx.club.findUnique({ where: { ownerId: userId } });
    if (!club) throw new ClubOperationsError("CLUB_NOT_FOUND");
    if (await replayCheck(tx, userId, club.id, idempotencyKey, reason)) return { prospectId, replayed: true };
    const prospect = await tx.academyProspect.findFirst({ where: { id: prospectId, clubId: club.id, status: "AVAILABLE" } });
    if (!prospect) throw new ClubOperationsError("PROSPECT_NOT_AVAILABLE");
    await debitCash(tx, userId, club.id, prospect.recruitmentCost, idempotencyKey, reason, "ACADEMY_RECRUITMENT", `Recruited ${prospect.firstName} ${prospect.lastName}`, now);
    const player = await tx.player.create({
      data: {
        clubId: club.id, firstName: prospect.firstName, lastName: prospect.lastName,
        nationality: prospect.nationality, age: prospect.age, position: prospect.position,
        overall: prospect.overall, potential: prospect.potential,
        attributes: prospect.attributes as Prisma.InputJsonValue,
        wage: BigInt(60 + prospect.overall), contractDays: 365,
        fitness: 100, morale: 75, status: "ACTIVE", origin: "GENERATED",
      },
      select: { id: true, firstName: true, lastName: true, position: true, overall: true, potential: true },
    });
    await tx.academyProspect.update({ where: { id: prospect.id }, data: { status: "RECRUITED", recruitedPlayerId: player.id, recruitedAt: now } });
    return { prospectId, player, cost: prospect.recruitmentCost.toString(), replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function upgradeClubCoach(userId: string, idempotencyKey: string, now = new Date()) {
  assertKey(idempotencyKey);
  await settleClubDailyState(userId, now);
  await settleClubEconomy(userId, now);
  const reason = "COACH_UPGRADE";
  return prisma.$transaction(async (tx) => {
    const club = await tx.club.findUnique({ where: { ownerId: userId }, include: { coach: true } });
    if (!club) throw new ClubOperationsError("CLUB_NOT_FOUND");
    if (await replayCheck(tx, userId, club.id, idempotencyKey, reason)) return { replayed: true };
    if (!club.coach) throw new ClubOperationsError("COACH_NOT_FOUND");
    if (club.coach.level >= 10) throw new ClubOperationsError("COACH_MAX_LEVEL");
    const cost = calculateCoachUpgradeCost(club.coach.level);
    await debitCash(tx, userId, club.id, cost, idempotencyKey, reason, "COACH_DEVELOPMENT", "Coach skill development", now);
    const coach = await tx.coach.update({
      where: { id: club.coach.id },
      data: {
        level: { increment: 1 },
        trainingSkill: Math.min(100, club.coach.trainingSkill + 5),
        recoverySkill: Math.min(100, club.coach.recoverySkill + 5),
        medicalSkill: Math.min(100, club.coach.medicalSkill + 5),
        weeklySalary: { increment: 40n },
      },
      select: { level: true, trainingSkill: true, recoverySkill: true, medicalSkill: true, weeklySalary: true },
    });
    return { coach: { ...coach, weeklySalary: coach.weeklySalary.toString() }, cost: cost.toString(), replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function hireClubCoach(userId: string, candidateId: string, idempotencyKey: string, now = new Date()) {
  assertKey(idempotencyKey);
  await settleClubDailyState(userId, now);
  await settleClubEconomy(userId, now);
  const candidate = COACH_CANDIDATES.find((item) => item.id === candidateId);
  if (!candidate) throw new ClubOperationsError("COACH_CANDIDATE_NOT_FOUND");
  const reason = "COACH_HIRING";
  return prisma.$transaction(async (tx) => {
    const club = await tx.club.findUnique({ where: { ownerId: userId } });
    if (!club) throw new ClubOperationsError("CLUB_NOT_FOUND");
    if (await replayCheck(tx, userId, club.id, idempotencyKey, reason)) return { replayed: true };
    await debitCash(tx, userId, club.id, candidate.signingFee, idempotencyKey, reason, "COACH_SIGNING", `Hired ${candidate.name}`, now);
    const coach = await tx.coach.upsert({
      where: { clubId: club.id },
      create: { clubId: club.id, name: candidate.name, level: 1, trainingSkill: candidate.trainingSkill, recoverySkill: candidate.recoverySkill, medicalSkill: candidate.medicalSkill, weeklySalary: candidate.weeklySalary },
      update: { name: candidate.name, level: 1, trainingSkill: candidate.trainingSkill, recoverySkill: candidate.recoverySkill, medicalSkill: candidate.medicalSkill, weeklySalary: candidate.weeklySalary },
      select: { name: true, level: true, trainingSkill: true, recoverySkill: true, medicalSkill: true, weeklySalary: true },
    });
    return { coach: { ...coach, weeklySalary: coach.weeklySalary.toString() }, signingFee: candidate.signingFee.toString(), replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function signClubSponsor(userId: string, offerId: string, idempotencyKey: string, now = new Date()) {
  assertKey(idempotencyKey);
  await settleClubDailyState(userId, now);
  await settleClubEconomy(userId, now);
  const reason = "SPONSOR_CONTRACT_SIGNING";
  return prisma.$transaction(async (tx) => {
    const club = await tx.club.findUnique({ where: { ownerId: userId }, include: { sponsors: { where: { status: "ACTIVE" } } } });
    if (!club) throw new ClubOperationsError("CLUB_NOT_FOUND");
    if (await replayCheck(tx, userId, club.id, idempotencyKey, reason)) return { replayed: true };
    if (club.sponsors.some((sponsor) => sponsor.endsAt > now)) throw new ClubOperationsError("ACTIVE_SPONSOR_EXISTS");
    const offer = getSponsorOffers(club.level, club.reputation).find((item) => item.id === offerId);
    if (!offer) throw new ClubOperationsError("SPONSOR_OFFER_LOCKED");
    const endsAt = new Date(now.getTime() + offer.durationDays * DAY_MS);
    await creditCash(tx, userId, club.id, offer.signingBonus, idempotencyKey, reason, "SPONSOR_SIGNING_BONUS", `Signing bonus from ${offer.partnerName}`, now);
    const sponsor = await tx.sponsorContract.create({
      data: {
        idempotencyKey: `sponsor:${idempotencyKey}`, clubId: club.id,
        partnerName: offer.partnerName, tier: offer.tier, dailyIncome: offer.dailyIncome,
        signingBonus: offer.signingBonus, startedAt: now, endsAt,
      },
      select: { id: true, partnerName: true, tier: true, dailyIncome: true, endsAt: true },
    });
    return { sponsor: { ...sponsor, dailyIncome: sponsor.dailyIncome.toString(), endsAt: sponsor.endsAt.toISOString() }, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateStadiumTicketPrice(
  userId: string, ticketPrice: bigint, expectedTicketPrice: bigint,
) {
  if (ticketPrice < 10n || ticketPrice > 500n) throw new ClubOperationsError("INVALID_TICKET_PRICE");
  const club = await prisma.club.findUnique({ where: { ownerId: userId }, select: { id: true, ticketPrice: true } });
  if (!club) throw new ClubOperationsError("CLUB_NOT_FOUND");
  const updated = await prisma.club.updateMany({
    where: { id: club.id, ownerId: userId, ticketPrice: expectedTicketPrice },
    data: { ticketPrice },
  });
  if (updated.count !== 1) throw new ClubOperationsError("TICKET_PRICE_CONFLICT");
  return { ticketPrice: ticketPrice.toString(), previousTicketPrice: club.ticketPrice.toString() };
}
