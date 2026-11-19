import { randomInt } from "node:crypto";
import { Prisma, type PlayerStatus, type TrainingFocus as DbTrainingFocus, type TrainingIntensity as DbTrainingIntensity } from "@prisma/client";
import {
  advancePlayerDailyState,
  applyAnnualAgeing,
  calculateContractDemand,
  calculatePayrollSettlement,
  calculateInjuryChanceBasisPoints,
  calculateTrainingResult,
  isTrainingFocusCompatible,
  type PlayerAttributes,
  type PlayerPosition,
  type TrainingFocus,
  type TrainingIntensity,
} from "@football/domain";
import { prisma } from "../db.js";
import { getPlayerDevelopmentPort } from "./player-development-context.js";

const DAY_MS = 86_400_000;
const focusValues = new Set<TrainingFocus>(["BALANCED", "GOALKEEPING", "DEFENDING", "PASSING", "PLAYMAKING", "DRIBBLING", "SHOOTING", "PHYSICAL"]);
const intensityValues = new Set<TrainingIntensity>(["LIGHT", "NORMAL", "INTENSE"]);

export class PlayerDevelopmentError extends Error {
  constructor(
    public readonly code: string,
    public readonly details?: Record<string, string>,
  ) {
    super(code);
    this.name = "PlayerDevelopmentError";
  }
}

function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function sameTrainingCommand(previous: {
  userId: string; playerId: string; focus: DbTrainingFocus; intensity: DbTrainingIntensity;
}, input: { userId: string; playerId: string; focus: TrainingFocus; intensity: TrainingIntensity }) {
  return previous.userId === input.userId && previous.playerId === input.playerId
    && previous.focus === input.focus && previous.intensity === input.intensity;
}

export async function settleClubDailyState(userId: string, now = new Date()) {
  const port = getPlayerDevelopmentPort();
  if (port) return port.settle(userId, now);
  const today = utcDay(now);
  try {
    return await prisma.$transaction(async (tx) => {
    const club = await tx.club.findUnique({
      where: { ownerId: userId },
      include: { coach: { select: { recoverySkill: true, weeklySalary: true } } },
    });
    if (!club) throw new PlayerDevelopmentError("CLUB_NOT_FOUND");
    const lastDay = utcDay(club.lastDailyTickAt);
    const elapsedDays = Math.max(0, Math.floor((today.getTime() - lastDay.getTime()) / DAY_MS));
    if (elapsedDays === 0) return { elapsedDays: 0, gameDate: today.toISOString().slice(0, 10), recovered: 0, expiredContracts: 0 };

    const players = await tx.player.findMany({
      where: { clubId: club.id, status: { in: ["ACTIVE", "INJURED", "CONTRACT_EXPIRED", "LISTED"] } },
      select: {
        id: true, age: true, ageDays: true, contractDays: true, fitness: true,
        morale: true, status: true, injuryUntil: true, lineupSlot: true,
        position: true, overall: true, potential: true, attributes: true, wage: true,
      },
    });
    let recovered = 0;
    let expiredContracts = 0;
    let lineupChanged = false;
    for (const player of players) {
      const next = advancePlayerDailyState({
        contractDays: player.contractDays,
        fitness: player.fitness,
        morale: player.morale,
        status: player.status as PlayerStatus,
        injuryUntil: player.injuryUntil,
      }, elapsedDays, now, club.coach?.recoverySkill ?? 25);
      const totalAgeDays = player.ageDays + elapsedDays;
      const yearsGained = Math.floor(totalAgeDays / 365);
      const aged = applyAnnualAgeing(player.position as PlayerPosition, player.attributes as unknown as PlayerAttributes, player.age, yearsGained);
      let status = next.status;
      if (player.age + yearsGained >= 40) status = "RETIRED";
      if (player.status === "INJURED" && status !== "INJURED") recovered++;
      if (player.contractDays > 0 && next.contractDays === 0) expiredContracts++;
      if (player.status === "LISTED" && status === "CONTRACT_EXPIRED") {
        await tx.playerMarketListing.updateMany({ where: { playerId: player.id, status: "OPEN" }, data: { status: "EXPIRED" } });
      }
      const shouldClearLineup = player.lineupSlot !== null && (status === "CONTRACT_EXPIRED" || status === "RETIRED");
      if (shouldClearLineup) lineupChanged = true;
      await tx.player.update({
        where: { id: player.id },
        data: {
          age: player.age + yearsGained,
          ageDays: totalAgeDays % 365,
          ...(yearsGained > 0 ? { attributes: aged.attributes as unknown as Prisma.InputJsonValue, overall: Math.min(player.potential, aged.overall) } : {}),
          contractDays: next.contractDays,
          fitness: next.fitness,
          morale: next.morale,
          status,
          injuryUntil: next.injuryUntil,
          ...(shouldClearLineup ? { lineupSlot: null } : {}),
        },
      });
    }

    const lastPayrollDay = utcDay(club.lastPayrollAt);
    const payrollElapsedDays = Math.max(0, Math.floor((today.getTime() - lastPayrollDay.getTime()) / DAY_MS));
    const weeksCovered = Math.floor(payrollElapsedDays / 7);
    let payrollSummary: { weeksCovered: number; playerWages: string; coachWages: string; totalDue: string; cashPaid: string; arrearsAfter: string } | null = null;
    let nextPayrollAt = club.lastPayrollAt;
    let nextWageArrears = club.wageArrears;
    if (weeksCovered > 0) {
      const wallet = await tx.wallet.findUnique({
        where: { userId_asset: { userId, asset: "CASH" } },
        select: { id: true, balance: true, version: true },
      });
      const payroll = calculatePayrollSettlement({
        players: players.map((player) => ({
          weeklyWage: player.wage,
          contractDays: player.contractDays,
          status: player.status as "ACTIVE" | "INJURED" | "CONTRACT_EXPIRED" | "LISTED" | "RETIRED",
        })),
        coachWeeklyWage: club.coach?.weeklySalary ?? 0n,
        elapsedDays: payrollElapsedDays,
        weeksCovered,
        arrearsBefore: club.wageArrears,
        cashAvailable: wallet?.balance ?? 0n,
      });
      const { playerWages, coachWages, totalDue, cashPaid, arrearsAfter, playersCount } = payroll;
      const payrollDate = new Date(lastPayrollDay.getTime() + weeksCovered * 7 * DAY_MS);
      if (cashPaid > 0n && wallet) {
        const paid = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: wallet.balance, version: wallet.version },
          data: { balance: { decrement: cashPaid }, version: { increment: 1 } },
        });
        if (paid.count !== 1) throw new PlayerDevelopmentError("DAILY_SETTLEMENT_CONFLICT");
        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: `weekly-payroll:${club.id}:${payrollDate.toISOString().slice(0, 10)}`,
            userId, asset: "CASH", direction: "DEBIT", amount: cashPaid,
            reason: "WEEKLY_PLAYER_AND_COACH_PAYROLL",
            referenceType: "CLUB_PAYROLL", referenceId: club.id,
          },
        });
      }
      await tx.clubPayroll.create({
        data: {
          clubId: club.id, payrollDate, weeksCovered, playerWages, coachWages,
          arrearsBefore: club.wageArrears, totalDue, cashPaid, arrearsAfter, playersCount,
        },
      });
      if (cashPaid > 0n) {
        await tx.clubFinanceEntry.create({
          data: {
            idempotencyKey: `club-finance-payroll:${club.id}:${payrollDate.toISOString().slice(0, 10)}`,
            clubId: club.id, category: "PLAYER_AND_COACH_PAYROLL", direction: "DEBIT",
            amount: cashPaid, description: `Weekly payroll cash paid; total due ${totalDue}`,
            occurredAt: payrollDate,
          },
        });
      }
      nextPayrollAt = payrollDate;
      nextWageArrears = arrearsAfter;
      if (arrearsAfter > 0n && totalDue > 0n) {
        const moralePenalty = Math.min(12, 2 + Number((arrearsAfter * 10n + totalDue - 1n) / totalDue));
        const eligible = { clubId: club.id, status: { in: ["ACTIVE", "INJURED", "CONTRACT_EXPIRED", "LISTED"] } } satisfies Prisma.PlayerWhereInput;
        await tx.player.updateMany({
          where: { ...eligible, morale: { gt: moralePenalty } },
          data: { morale: { decrement: moralePenalty } },
        });
        await tx.player.updateMany({
          where: { ...eligible, morale: { lte: moralePenalty } },
          data: { morale: 0 },
        });
      }
      payrollSummary = {
        weeksCovered, playerWages: playerWages.toString(), coachWages: coachWages.toString(),
        totalDue: totalDue.toString(), cashPaid: cashPaid.toString(), arrearsAfter: arrearsAfter.toString(),
      };
    }

    const advanced = await tx.club.updateMany({
      where: { id: club.id, lastDailyTickAt: club.lastDailyTickAt },
      data: {
        lastDailyTickAt: today,
        ...(weeksCovered > 0 ? { lastPayrollAt: nextPayrollAt, wageArrears: nextWageArrears } : {}),
        ...(lineupChanged ? { lineupVersion: { increment: 1 } } : {}),
      },
    });
    if (advanced.count !== 1) throw new PlayerDevelopmentError("DAILY_SETTLEMENT_CONFLICT");
    await tx.clubDailyTick.create({
      data: { clubId: club.id, gameDate: today, elapsedDays },
    });
    return { elapsedDays, gameDate: today.toISOString().slice(0, 10), recovered, expiredContracts, payroll: payrollSummary };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if ((error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
      || (error instanceof PlayerDevelopmentError && error.code === "DAILY_SETTLEMENT_CONFLICT")) {
      return { elapsedDays: 0, gameDate: today.toISOString().slice(0, 10), recovered: 0, expiredContracts: 0 };
    }
    throw error;
  }
}

export async function getClubDevelopment(userId: string, now = new Date()) {
  const port = getPlayerDevelopmentPort();
  if (port) return port.get(userId, now);
  await settleClubDailyState(userId, now);
  const club = await prisma.club.findUnique({
    where: { ownerId: userId },
    include: {
      coach: true,
      players: {
        where: { status: { in: ["ACTIVE", "INJURED", "CONTRACT_EXPIRED", "LISTED"] } },
        orderBy: [{ status: "asc" }, { overall: "desc" }],
        select: {
          id: true, firstName: true, lastName: true, nationality: true, age: true, ageDays: true,
          position: true, overall: true, potential: true, attributes: true, wage: true,
          contractDays: true, morale: true, fitness: true, status: true, injuryUntil: true,
          trainingFocus: true, lastTrainedAt: true, lineupSlot: true,
        },
      },
      trainingLogs: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, playerId: true, focus: true, intensity: true, overallBefore: true, overallAfter: true, injuryOccurred: true, createdAt: true } },
      contractRenewals: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, playerId: true, extensionDays: true, oldWage: true, newWage: true, createdAt: true } },
      payrolls: { orderBy: { payrollDate: "desc" }, take: 8, select: { id: true, payrollDate: true, weeksCovered: true, playerWages: true, coachWages: true, totalDue: true, cashPaid: true, arrearsAfter: true, playersCount: true } },
    },
  });
  if (!club) throw new PlayerDevelopmentError("CLUB_NOT_FOUND");
  const coach = club.coach ?? await prisma.coach.upsert({
    where: { clubId: club.id },
    create: { clubId: club.id, name: "Academy Coach", trainingSkill: 35, recoverySkill: 30, medicalSkill: 25, weeklySalary: 100n },
    update: {},
  });
  return {
    club: {
      id: club.id, name: club.name, trainingGroundLevel: club.trainingGroundLevel,
      wageArrears: club.wageArrears.toString(), lastPayrollAt: club.lastPayrollAt.toISOString(),
      weeklyWageBill: (club.players.filter((player) => player.contractDays > 0 && player.status !== "RETIRED").reduce((total, player) => total + player.wage, coach.weeklySalary)).toString(),
      coach: {
        id: coach.id, name: coach.name, level: coach.level,
        trainingSkill: coach.trainingSkill, recoverySkill: coach.recoverySkill,
        medicalSkill: coach.medicalSkill, weeklySalary: coach.weeklySalary.toString(),
      },
      players: club.players.map((player) => ({
        ...player,
        wage: player.wage.toString(),
        minimumWeeklyWage: calculateContractDemand({
          age: player.age, overall: player.overall, potential: player.potential,
          morale: player.morale, currentWeeklyWage: player.wage,
        }).minimumWeeklyWage.toString(),
        maximumWeeklyWage: calculateContractDemand({
          age: player.age, overall: player.overall, potential: player.potential,
          morale: player.morale, currentWeeklyWage: player.wage,
        }).maximumWeeklyWage.toString(),
      })),
      recentTraining: club.trainingLogs.map((log) => ({
        ...log, createdAt: log.createdAt.toISOString(),
      })),
      recentRenewals: club.contractRenewals.map((renewal) => ({
        ...renewal, oldWage: renewal.oldWage.toString(), newWage: renewal.newWage.toString(),
        createdAt: renewal.createdAt.toISOString(),
      })),
      recentPayrolls: club.payrolls.map((payroll) => ({
        ...payroll, payrollDate: payroll.payrollDate.toISOString().slice(0, 10),
        playerWages: payroll.playerWages.toString(), coachWages: payroll.coachWages.toString(),
        totalDue: payroll.totalDue.toString(), cashPaid: payroll.cashPaid.toString(), arrearsAfter: payroll.arrearsAfter.toString(),
      })),
    },
  };
}

export async function trainPlayer(
  userId: string,
  playerId: string,
  focus: TrainingFocus,
  intensity: TrainingIntensity,
  idempotencyKey: string,
  now = new Date(),
) {
  const port = getPlayerDevelopmentPort();
  if (port) { try { return await port.train(userId, playerId, focus, intensity, idempotencyKey, now); } catch (error) { if (error instanceof Error) throw new PlayerDevelopmentError(error.message, (error as Error & {details?:Record<string,string>}).details); throw error; } }
  if (!focusValues.has(focus)) throw new PlayerDevelopmentError("INVALID_TRAINING_FOCUS");
  if (!intensityValues.has(intensity)) throw new PlayerDevelopmentError("INVALID_TRAINING_INTENSITY");
  if (!/^[A-Za-z0-9:_-]{12,128}$/.test(idempotencyKey)) throw new PlayerDevelopmentError("INVALID_IDEMPOTENCY_KEY");
  await settleClubDailyState(userId, now);
  const trainingDate = utcDay(now);

  try {
    return await prisma.$transaction(async (tx) => {
      const previous = await tx.playerTrainingLog.findUnique({ where: { idempotencyKey } });
      if (previous) {
        if (!sameTrainingCommand(previous, { userId, playerId, focus, intensity })) {
          throw new PlayerDevelopmentError("IDEMPOTENCY_CONFLICT");
        }
        const wallet = await tx.wallet.findUnique({ where: { userId_asset: { userId, asset: "CASH" } }, select: { balance: true } });
        return {
          playerId, focus, intensity, overallBefore: previous.overallBefore,
          overallAfter: previous.overallAfter, fitnessBefore: previous.fitnessBefore,
          fitnessAfter: previous.fitnessAfter, injuryOccurred: previous.injuryOccurred,
          injuryUntil: previous.injuryUntil?.toISOString() ?? null,
          cashCost: previous.cashCost.toString(), cashBalance: wallet?.balance.toString() ?? "0",
          replayed: true,
        };
      }

      const club = await tx.club.findUnique({
        where: { ownerId: userId },
        include: { coach: true },
      });
      if (!club) throw new PlayerDevelopmentError("CLUB_NOT_FOUND");
      const player = await tx.player.findFirst({ where: { id: playerId, clubId: club.id } });
      if (!player) throw new PlayerDevelopmentError("PLAYER_NOT_FOUND");
      if (player.status === "INJURED") throw new PlayerDevelopmentError("PLAYER_INJURED");
      if (player.status === "CONTRACT_EXPIRED") throw new PlayerDevelopmentError("CONTRACT_EXPIRED");
      if (player.status !== "ACTIVE") throw new PlayerDevelopmentError("PLAYER_NOT_AVAILABLE");
      if (!isTrainingFocusCompatible(player.position, focus)) throw new PlayerDevelopmentError("INCOMPATIBLE_TRAINING_FOCUS");
      const alreadyTrained = await tx.playerTrainingLog.findUnique({
        where: { playerId_trainingDate: { playerId, trainingDate } },
        select: { id: true },
      });
      if (alreadyTrained) throw new PlayerDevelopmentError("ALREADY_TRAINED_TODAY");

      const coach = club.coach ?? await tx.coach.create({
        data: { clubId: club.id, name: "Academy Coach", trainingSkill: 35, recoverySkill: 30, medicalSkill: 25, weeklySalary: 100n },
      });
      const baseCost = intensity === "LIGHT" ? 20 : intensity === "NORMAL" ? 40 : 70;
      const cashCost = BigInt(Math.round(baseCost * (1 + (club.trainingGroundLevel - 1) * 0.1)));
      const wallet = await tx.wallet.findUnique({
        where: { userId_asset: { userId, asset: "CASH" } },
        select: { id: true, balance: true, version: true },
      });
      if (!wallet) throw new PlayerDevelopmentError("WALLET_NOT_FOUND");
      if (wallet.balance < cashCost) throw new PlayerDevelopmentError("INSUFFICIENT_CASH");

      const result = calculateTrainingResult({
        age: player.age, position: player.position, overall: player.overall,
        potential: player.potential, attributes: player.attributes as unknown as PlayerAttributes,
        fitness: player.fitness, morale: player.morale,
      }, focus, intensity, coach.trainingSkill, club.trainingGroundLevel, randomInt(0, 10_000));
      const injuryChance = calculateInjuryChanceBasisPoints(player.fitness, intensity, coach.medicalSkill);
      const injuryOccurred = randomInt(0, 10_000) < injuryChance;
      const injuryUntil = injuryOccurred
        ? new Date(now.getTime() + randomInt(2, 11) * DAY_MS)
        : null;
      const nextFitness = injuryOccurred ? Math.max(10, result.fitness - 25) : result.fitness;
      const nextMorale = injuryOccurred ? Math.max(0, result.morale - 5) : result.morale;

      const debit = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { equals: wallet.balance, gte: cashCost }, version: wallet.version },
        data: { balance: { decrement: cashCost }, version: { increment: 1 } },
      });
      if (debit.count !== 1) throw new PlayerDevelopmentError("CONCURRENT_MODIFICATION");
      await tx.ledgerTransaction.create({
        data: {
          idempotencyKey: `player-training:${idempotencyKey}`,
          userId, asset: "CASH", direction: "DEBIT", amount: cashCost,
          reason: "PLAYER_TRAINING", referenceType: "PLAYER", referenceId: playerId,
        },
      });
      await tx.clubFinanceEntry.create({
        data: {
          idempotencyKey: `club-finance-training:${idempotencyKey}`,
          clubId: club.id, category: "PLAYER_TRAINING", direction: "DEBIT",
          amount: cashCost, description: `Training session for ${player.firstName} ${player.lastName}`,
          occurredAt: now,
        },
      });
      if (injuryOccurred && player.lineupSlot !== null) {
        await tx.club.update({ where: { id: club.id }, data: { lineupVersion: { increment: 1 } } });
      }
      await tx.player.update({
        where: { id: player.id },
        data: {
          ...(injuryOccurred ? { lineupSlot: null } : {}),
          attributes: result.attributes as unknown as Prisma.InputJsonValue,
          overall: result.overall,
          fitness: nextFitness,
          morale: nextMorale,
          trainingFocus: focus as DbTrainingFocus,
          lastTrainedAt: now,
          status: injuryOccurred ? "INJURED" : "ACTIVE",
          injuryUntil,
        },
      });
      await tx.playerTrainingLog.create({
        data: {
          idempotencyKey, userId, clubId: club.id, playerId, trainingDate,
          focus: focus as DbTrainingFocus, intensity: intensity as DbTrainingIntensity,
          cashCost, overallBefore: player.overall, overallAfter: result.overall,
          fitnessBefore: player.fitness, fitnessAfter: nextFitness,
          attributesBefore: player.attributes as Prisma.InputJsonValue,
          attributesAfter: result.attributes as unknown as Prisma.InputJsonValue,
          injuryOccurred, injuryUntil,
        },
      });
      return {
        playerId, focus, intensity, overallBefore: player.overall,
        overallAfter: result.overall, fitnessBefore: player.fitness,
        fitnessAfter: nextFitness, injuryOccurred, injuryUntil: injuryUntil?.toISOString() ?? null,
        cashCost: cashCost.toString(), cashBalance: (wallet.balance - cashCost).toString(),
        attributeGain: result.attributeGain, replayed: false,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof PlayerDevelopmentError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const previous = await prisma.playerTrainingLog.findUnique({ where: { idempotencyKey } });
      if (previous && sameTrainingCommand(previous, { userId, playerId, focus, intensity })) {
        const wallet = await prisma.wallet.findUnique({ where: { userId_asset: { userId, asset: "CASH" } }, select: { balance: true } });
        return {
          playerId, focus, intensity, overallBefore: previous.overallBefore,
          overallAfter: previous.overallAfter, fitnessBefore: previous.fitnessBefore,
          fitnessAfter: previous.fitnessAfter, injuryOccurred: previous.injuryOccurred,
          injuryUntil: previous.injuryUntil?.toISOString() ?? null,
          cashCost: previous.cashCost.toString(), cashBalance: wallet?.balance.toString() ?? "0",
          replayed: true,
        };
      }
      throw new PlayerDevelopmentError("ALREADY_TRAINED_TODAY");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new PlayerDevelopmentError("CONCURRENT_MODIFICATION");
    }
    throw error;
  }
}

export async function renewPlayerContract(
  userId: string,
  playerId: string,
  extensionDays: number,
  weeklyWage: bigint,
  idempotencyKey: string,
  now = new Date(),
) {
  const port = getPlayerDevelopmentPort();
  if (port) { try { return await port.renew(userId, playerId, extensionDays, weeklyWage, idempotencyKey, now); } catch (error) { if (error instanceof Error) throw new PlayerDevelopmentError(error.message, (error as Error & {details?:Record<string,string>}).details); throw error; } }
  if (![90, 180, 365].includes(extensionDays)) throw new PlayerDevelopmentError("INVALID_CONTRACT_LENGTH");
  if (!/^[A-Za-z0-9:_-]{12,128}$/.test(idempotencyKey)) throw new PlayerDevelopmentError("INVALID_IDEMPOTENCY_KEY");
  if (weeklyWage <= 0n || weeklyWage > 1_000_000n) throw new PlayerDevelopmentError("INVALID_WEEKLY_WAGE");
  await settleClubDailyState(userId, now);

  try {
    return await prisma.$transaction(async (tx) => {
      const previous = await tx.playerContractRenewal.findUnique({ where: { idempotencyKey } });
      if (previous) {
        if (previous.userId !== userId || previous.playerId !== playerId
          || previous.extensionDays !== extensionDays || previous.newWage !== weeklyWage) {
          throw new PlayerDevelopmentError("IDEMPOTENCY_CONFLICT");
        }
        const current = await tx.player.findUnique({ where: { id: playerId }, select: { contractDays: true, wage: true, status: true } });
        return {
          playerId, extensionDays, contractDays: current?.contractDays ?? previous.newContractDays,
          weeklyWage: current?.wage.toString() ?? previous.newWage.toString(),
          replayed: true,
        };
      }
      const club = await tx.club.findUnique({ where: { ownerId: userId }, select: { id: true } });
      if (!club) throw new PlayerDevelopmentError("CLUB_NOT_FOUND");
      const player = await tx.player.findFirst({ where: { id: playerId, clubId: club.id } });
      if (!player) throw new PlayerDevelopmentError("PLAYER_NOT_FOUND");
      if (player.status === "LISTED" || player.status === "RETIRED") throw new PlayerDevelopmentError("PLAYER_NOT_AVAILABLE");
      const demand = calculateContractDemand({
        age: player.age, overall: player.overall, potential: player.potential,
        morale: player.morale, currentWeeklyWage: player.wage,
      });
      if (weeklyWage < demand.minimumWeeklyWage) {
        throw new PlayerDevelopmentError("WAGE_OFFER_TOO_LOW", {
          minimumWeeklyWage: demand.minimumWeeklyWage.toString(),
          maximumWeeklyWage: demand.maximumWeeklyWage.toString(),
        });
      }
      if (weeklyWage > demand.maximumWeeklyWage) {
        throw new PlayerDevelopmentError("WAGE_OFFER_TOO_HIGH", {
          minimumWeeklyWage: demand.minimumWeeklyWage.toString(),
          maximumWeeklyWage: demand.maximumWeeklyWage.toString(),
        });
      }
      const oldContractDays = player.contractDays;
      const newContractDays = Math.min(1095, Math.max(0, oldContractDays) + extensionDays);
      const nextStatus: PlayerStatus = player.injuryUntil && player.injuryUntil > now ? "INJURED" : "ACTIVE";
      await tx.player.update({
        where: { id: player.id },
        data: { contractDays: newContractDays, wage: weeklyWage, status: nextStatus },
      });
      await tx.playerContractRenewal.create({
        data: {
          idempotencyKey, userId, clubId: club.id, playerId, extensionDays,
          oldContractDays, newContractDays, oldWage: player.wage, newWage: weeklyWage,
        },
      });
      return {
        playerId, extensionDays, oldContractDays, contractDays: newContractDays,
        oldWeeklyWage: player.wage.toString(), weeklyWage: weeklyWage.toString(),
        replayed: false,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof PlayerDevelopmentError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const previous = await prisma.playerContractRenewal.findUnique({ where: { idempotencyKey } });
      if (previous && previous.userId === userId && previous.playerId === playerId
        && previous.extensionDays === extensionDays && previous.newWage === weeklyWage) {
        return {
          playerId, extensionDays, contractDays: previous.newContractDays,
          weeklyWage: previous.newWage.toString(), replayed: true,
        };
      }
      throw new PlayerDevelopmentError("IDEMPOTENCY_CONFLICT");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new PlayerDevelopmentError("CONCURRENT_MODIFICATION");
    }
    throw error;
  }
}
