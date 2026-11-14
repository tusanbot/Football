import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../src/db.js";
import {
  createFriendlyMatch, createLeague, getLeague, joinLeague, listClubMatches,
  simulateScheduledMatch, startLeague,
} from "../src/game/match-service.js";

const positions = ["GK","RB","CB","CB","LB","CDM","CM","CAM","RW","ST","LW"] as const;
async function makeClub(suffix: string, index: number) {
  const user = await prisma.user.create({
    data: {
      telegramId: `match-${suffix}-${index}`, displayName: `Match User ${index}`,
      club: { create: { name: `Match Club ${index}`, slug: `match-${suffix}-${index}`, stadiumLevel: 2, ticketPrice: 45n } },
      wallets: { create: [{ asset: "CASH", balance: 1000n }, { asset: "GOLD", balance: 10n }] },
    }, include: { club: true },
  });
  const clubId = user.club!.id;
  await prisma.player.createMany({ data: positions.map((position, slot) => ({
    clubId, firstName: `Player${slot}`, lastName: `Club${index}`, nationality: "IR",
    age: 22 + (slot % 8), position, overall: 55 + index * 3, potential: 75 + index * 2,
    attributes: {
      pace: 60 + index * 3, shooting: 60 + index * 3, passing: 60 + index * 3,
      dribbling: 60 + index * 3, defending: 60 + index * 3, physical: 60 + index * 3,
      goalkeeping: position === "GK" ? 70 + index * 2 : 25,
    },
    wage: 100n, contractDays: 300, morale: 75, fitness: 95, lineupSlot: slot + 1,
  })) });
  return { userId: user.id, clubId };
}

test("friendly match simulation settles score, events, fitness, gate revenue and is idempotent", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const clubs: Array<{ userId: string; clubId: string }> = [];
  try {
    clubs.push(await makeClub(suffix, 0), await makeClub(suffix, 1));
    const scheduledAt = new Date(Date.now() - 30_000);
    const key = `friendly-${suffix}`;
    const created = await createFriendlyMatch(clubs[0]!.userId, clubs[1]!.clubId, key, scheduledAt);
    assert.equal(created.replayed, false);
    const before = await prisma.wallet.findUniqueOrThrow({
      where: { userId_asset: { userId: clubs[0]!.userId, asset: "CASH" } },
    });
    const result = await simulateScheduledMatch(clubs[0]!.userId, created.match.id);
    assert.equal(result.replayed, false);
    assert.ok((result.homeScore ?? -1) >= 0);
    assert.ok((result.awayScore ?? -1) >= 0);
    assert.ok((result.events?.length ?? 0) >= 0);
    const match = await prisma.footballMatch.findUniqueOrThrow({ where: { id: created.match.id } });
    assert.equal(match.status, "COMPLETED");
    assert.equal(await prisma.matchEvent.count({ where: { matchId: match.id } }), result.events?.length ?? 0);
    assert.equal(await prisma.playerMatchPerformance.count({ where: { matchId: match.id } }), 22);
    const after = await prisma.wallet.findUniqueOrThrow({
      where: { userId_asset: { userId: clubs[0]!.userId, asset: "CASH" } },
    });
    assert.ok(after.balance > before.balance);
    const replay = await simulateScheduledMatch(clubs[1]!.userId, match.id);
    assert.equal(replay.replayed, true);
    assert.equal(await prisma.ledgerTransaction.count({ where: { referenceType: "FOOTBALL_MATCH", referenceId: match.id } }), 2);
    const list = await listClubMatches(clubs[0]!.userId);
    assert.equal(list.matches.length, 1);
    assert.equal(list.matches[0]!.status, "COMPLETED");
  } finally {
    const clubIds = clubs.map((club) => club.clubId);
    if (clubIds.length) {
      await prisma.footballMatch.deleteMany({ where: { OR: [{ homeClubId: { in: clubIds } }, { awayClubId: { in: clubIds } }] } });
      await prisma.competition.deleteMany({ where: { createdByClubId: { in: clubIds } } });
      await prisma.player.deleteMany({ where: { clubId: { in: clubIds } } });
      await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    }
    const userIds = clubs.map((club) => club.userId);
    if (userIds.length) {
      await prisma.ledgerTransaction.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
});

test("league registration, round-robin fixtures and final standings are transactional", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const clubs: Array<{ userId: string; clubId: string }> = [];
  let competitionId: string | undefined;
  try {
    for (let i = 0; i < 4; i++) clubs.push(await makeClub(suffix, i));
    const created = await createLeague(clubs[0]!.userId, `Test League ${suffix.slice(0, 6)}`, 4, `league-create-${suffix}`);
    competitionId = created.competition.id;
    assert.equal(created.replayed, false);
    const replay = await createLeague(clubs[0]!.userId, created.competition.name, 4, `league-create-${suffix}`);
    assert.equal(replay.replayed, true);
    for (const member of clubs.slice(1)) {
      const joined = await joinLeague(member.userId, competitionId);
      assert.equal(joined.joined, true);
    }
    const started = await startLeague(clubs[0]!.userId, competitionId, new Date());
    assert.equal(started.teams, 4);
    assert.equal(started.fixturesCreated, 6);
    const fixtures = await prisma.footballMatch.findMany({ where: { competitionId }, orderBy: { scheduledAt: "asc" } });
    assert.equal(fixtures.length, 6);
    for (const fixture of fixtures) {
      const owner = clubs.find((club) => club.clubId === fixture.homeClubId || club.clubId === fixture.awayClubId)!;
      await simulateScheduledMatch(owner.userId, fixture.id, new Date(fixture.scheduledAt.getTime() + 60_000));
    }
    const table = await getLeague(clubs[0]!.userId, competitionId);
    assert.equal(table.competition.status, "COMPLETED");
    assert.equal(table.standings.length, 4);
    assert.equal(table.standings.reduce((sum, row) => sum + row.played, 0), 12);
    assert.equal(table.standings.reduce((sum, row) => sum + row.points, 0) >= 12, true);
    assert.equal(table.matches.filter((match) => match.status === "COMPLETED").length, 6);
  } finally {
    const clubIds = clubs.map((club) => club.clubId);
    if (clubIds.length) {
      await prisma.footballMatch.deleteMany({ where: { OR: [{ homeClubId: { in: clubIds } }, { awayClubId: { in: clubIds } }] } });
      if (competitionId) await prisma.competition.deleteMany({ where: { id: competitionId } });
      await prisma.player.deleteMany({ where: { clubId: { in: clubIds } } });
      await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    }
    const userIds = clubs.map((club) => club.userId);
    if (userIds.length) {
      await prisma.ledgerTransaction.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
});
