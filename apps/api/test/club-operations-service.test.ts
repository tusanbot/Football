import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../src/db.js";
import {
  hireClubCoach,
  recruitAcademyProspect,
  scoutAcademy,
  settleClubEconomy,
  signClubSponsor,
  upgradeClubCoach,
  upgradeClubFacility,
  updateStadiumTicketPrice,
} from "../src/game/club-operations-service.js";

const DAY_MS = 86_400_000;

test("club facilities, academy, coach, sponsor income and finance ledger are transactional and idempotent", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }

  const suffix = randomUUID().replaceAll("-", "");
  const now = new Date();
  let userId: string | undefined;
  let clubId: string | undefined;
  let recruitedPlayerId: string | undefined;

  try {
    const user = await prisma.user.create({
      data: {
        telegramId: `ops-test-${suffix}`,
        displayName: "Club Operations Test",
        club: {
          create: {
            name: "Operations Test FC",
            slug: `operations-${suffix}`,
            lastDailyTickAt: now,
            lastPayrollAt: now,
            lastEconomyTickAt: now,
          },
        },
        wallets: { create: [
          { asset: "CASH", balance: 20_000n },
          { asset: "GOLD", balance: 50n },
        ] },
      },
      include: { club: true },
    });
    userId = user.id;
    clubId = user.club!.id;
    await prisma.coach.create({
      data: { clubId, name: "Starter Coach", trainingSkill: 35, recoverySkill: 30, medicalSkill: 25, weeklySalary: 100n },
    });
    const ticketing = await updateStadiumTicketPrice(userId, 75n, 50n);
    assert.equal(ticketing.ticketPrice, "75");
    const replayedTicketing = await updateStadiumTicketPrice(userId, 75n, 50n);
    assert.equal(replayedTicketing.replayed, true);
    await assert.rejects(
      updateStadiumTicketPrice(userId, 80n, 50n),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "TICKET_PRICE_CONFLICT",
    );

    const academyUpgrade = await upgradeClubFacility(userId, "ACADEMY", `academy-upgrade-${suffix}`, now);
    assert.equal(academyUpgrade.level, 1);
    assert.equal(academyUpgrade.cost, "3500");
    const replayedUpgrade = await upgradeClubFacility(userId, "ACADEMY", `academy-upgrade-${suffix}`, now);
    assert.equal(replayedUpgrade.replayed, true);

    const scouting = await scoutAcademy(userId, `academy-scout-${suffix}`, now);
    assert.equal(scouting.prospects.length, 3);
    assert.equal(scouting.scoutingCost, "1750");
    const afterScout = await prisma.wallet.findUniqueOrThrow({ where: { userId_asset: { userId, asset: "CASH" } } });
    const replayedScouting = await scoutAcademy(userId, `academy-scout-${suffix}`, now);
    assert.equal(replayedScouting.replayed, true);
    assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { userId_asset: { userId, asset: "CASH" } } })).balance, afterScout.balance);

    const recruited = await recruitAcademyProspect(userId, scouting.prospects[0]!.id, `academy-recruit-${suffix}`, now);
    assert.equal(recruited.replayed, false);
    recruitedPlayerId = recruited.player!.id;
    const player = await prisma.player.findUniqueOrThrow({ where: { id: recruitedPlayerId } });
    assert.equal(player.age >= 16 && player.age <= 18, true);
    assert.equal(player.status, "ACTIVE");

    const hired = await hireClubCoach(userId, "youth", `coach-hire-${suffix}`, now);
    assert.equal(hired.coach!.name, "Youth Development Coach");
    const upgradedCoach = await upgradeClubCoach(userId, `coach-upgrade-${suffix}`, now);
    assert.equal(upgradedCoach.coach!.level, 2);
    assert.equal(upgradedCoach.coach!.trainingSkill, 70);

    const sponsor = await signClubSponsor(userId, "local-partner", `sponsor-sign-${suffix}`, now);
    assert.equal(sponsor.sponsor!.dailyIncome, "180");
    assert.equal(sponsor.replayed, false);

    const nextDay = new Date(now.getTime() + DAY_MS);
    const settlement = await settleClubEconomy(userId, nextDay);
    assert.equal(settlement.elapsedDays, 1);
    assert.equal(settlement.sponsorIncome, "180");
    assert.equal(settlement.operatingCost, "45");
    assert.equal(settlement.paid, "45");
    assert.equal(settlement.arrears, "0");

    const repeated = await settleClubEconomy(userId, nextDay);
    assert.equal(repeated.elapsedDays, 0);
    assert.equal(await prisma.clubEconomyTick.count({ where: { clubId } }), 1);
    assert.equal(await prisma.ledgerTransaction.count({
      where: { userId, reason: "SPONSOR_DAILY_INCOME" },
    }), 1);
    assert.equal(await prisma.ledgerTransaction.count({
      where: { userId, reason: "CLUB_FACILITY_MAINTENANCE" },
    }), 1);
    assert.ok(await prisma.clubFinanceEntry.count({ where: { clubId } }) >= 6);
  } finally {
    if (clubId) {
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
