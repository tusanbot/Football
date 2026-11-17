import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { calculateContractDemand } from "@football/domain";
import { prisma } from "../src/db.js";
import {
  renewPlayerContract,
  settleClubDailyState,
  trainPlayer,
} from "../src/players/player-development-service.js";

const DAY_MS = 86_400_000;

test("player training, contract renewal, daily recovery and weekly payroll are atomic and idempotent", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }

  const suffix = randomUUID().replaceAll("-", "");
  const now = new Date();
  const telegramId = `devtest-${suffix}`;
  let userId: string | undefined;
  let clubId: string | undefined;
  let playerIds: string[] = [];

  try {
    const user = await prisma.user.create({
      data: {
        telegramId,
        displayName: "Lifecycle Test",
        club: {
          create: {
            name: "Lifecycle Test FC",
            slug: `lifecycle-${suffix}`,
            lastDailyTickAt: now,
            lastPayrollAt: now,
            lineupVersion: 2,
          },
        },
        wallets: { create: [
          { asset: "CASH", balance: 10_000n },
          { asset: "GOLD", balance: 50n },
        ] },
      },
      include: { club: true },
    });
    userId = user.id;
    clubId = user.club!.id;

    await prisma.coach.create({
      data: {
        clubId,
        name: "Test Coach",
        trainingSkill: 100,
        recoverySkill: 80,
        medicalSkill: 100,
        weeklySalary: 100n,
      },
    });

    const attributes = {
      pace: 60, shooting: 60, passing: 55, dribbling: 58,
      defending: 35, physical: 62, goalkeeping: 25,
    };
    const player = await prisma.player.create({
      data: {
        clubId, firstName: "Test", lastName: "Striker", nationality: "IR",
        age: 20, position: "ST", overall: 58, potential: 82, attributes,
        wage: 150n, contractDays: 365, fitness: 90, morale: 75, lineupSlot: 1,
      },
    });
    const expiringPlayer = await prisma.player.create({
      data: {
        clubId, firstName: "Short", lastName: "Contract", nationality: "IR",
        age: 30, position: "CB", overall: 55, potential: 60,
        attributes: { ...attributes, defending: 65 },
        wage: 70n, contractDays: 1, fitness: 70, morale: 70, lineupSlot: 2,
      },
    });
    playerIds = [player.id, expiringPlayer.id];

    const trainingKey = `training-${suffix}`;
    const trained = await trainPlayer(userId, player.id, "SHOOTING", "NORMAL", trainingKey, now);
    assert.equal(trained.cashCost, "40");
    assert.equal(trained.replayed, false);

    const cashAfterTraining = await prisma.wallet.findUniqueOrThrow({
      where: { userId_asset: { userId, asset: "CASH" } },
    });
    assert.equal(cashAfterTraining.balance, 9_960n);

    const replayedTraining = await trainPlayer(userId, player.id, "SHOOTING", "NORMAL", trainingKey, now);
    assert.equal(replayedTraining.replayed, true);
    assert.equal((await prisma.wallet.findUniqueOrThrow({
      where: { userId_asset: { userId, asset: "CASH" } },
    })).balance, 9_960n);

    await assert.rejects(
      trainPlayer(userId, player.id, "SHOOTING", "LIGHT", `second-training-${suffix}`, now),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "ALREADY_TRAINED_TODAY",
    );

    const demand = calculateContractDemand({
      age: player.age, overall: player.overall, potential: player.potential,
      morale: player.morale, currentWeeklyWage: player.wage,
    });
    const renewalKey = `renewal-${suffix}`;
    const renewed = await renewPlayerContract(userId, player.id, 180, demand.minimumWeeklyWage, renewalKey, now);
    assert.equal(renewed.contractDays, 545);
    assert.equal(renewed.replayed, false);

    const replayedRenewal = await renewPlayerContract(userId, player.id, 180, demand.minimumWeeklyWage, renewalKey, now);
    assert.equal(replayedRenewal.replayed, true);

    const nextWeek = new Date(now.getTime() + 7 * DAY_MS);
    const settlement = await settleClubDailyState(userId, nextWeek);
    assert.equal(settlement.elapsedDays, 7);
    assert.ok(settlement.payroll);
    assert.equal(settlement.payroll?.cashPaid, settlement.payroll?.totalDue);
    assert.equal(settlement.payroll?.arrearsAfter, "0");

    const updatedPlayer = await prisma.player.findUniqueOrThrow({ where: { id: player.id } });
    assert.equal(updatedPlayer.contractDays, 538);
    assert.equal(updatedPlayer.status, "ACTIVE");
    assert.ok(updatedPlayer.fitness >= 90);

    const expired = await prisma.player.findUniqueOrThrow({ where: { id: expiringPlayer.id } });
    assert.equal(expired.contractDays, 0);
    assert.equal(expired.status, "CONTRACT_EXPIRED");
    assert.equal(expired.lineupSlot, null);

    const club = await prisma.club.findUniqueOrThrow({ where: { id: clubId } });
    assert.equal(club.lineupVersion, 3);
    assert.equal(club.wageArrears, 0n);

    const payrollRows = await prisma.clubPayroll.count({ where: { clubId } });
    assert.equal(payrollRows, 1);
    const payrollLedger = await prisma.ledgerTransaction.count({
      where: { userId, reason: "WEEKLY_PLAYER_AND_COACH_PAYROLL" },
    });
    assert.equal(payrollLedger, 1);

    const repeatedSettlement = await settleClubDailyState(userId, nextWeek);
    assert.equal(repeatedSettlement.elapsedDays, 0);
    assert.equal(await prisma.clubPayroll.count({ where: { clubId } }), 1);
  } finally {
    if (clubId) {
      await prisma.playerTrainingLog.deleteMany({ where: { clubId } });
      await prisma.playerContractRenewal.deleteMany({ where: { clubId } });
      await prisma.clubPayroll.deleteMany({ where: { clubId } });
      await prisma.clubDailyTick.deleteMany({ where: { clubId } });
      await prisma.playerMarketListing.deleteMany({ where: { sellerClubId: clubId } });
      await prisma.player.deleteMany({ where: { clubId } });
      await prisma.coach.deleteMany({ where: { clubId } });
      await prisma.club.deleteMany({ where: { id: clubId } });
    }
    if (userId) {
      await prisma.ledgerTransaction.deleteMany({ where: { userId } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  }
});
