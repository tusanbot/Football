import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../src/db.js";
import { applyForPyramidLeague, createFriendlyChallenge, getPyramidLeagueDetails } from "../src/game/league-pyramid-service.js";

const positions = ["GK", "RB", "CB", "CB", "LB", "CDM", "CM", "CAM", "RW", "ST", "LW"] as const;

async function makePyramidClub(suffix: string, index: number) {
  const user = await prisma.user.create({
    data: {
      telegramId: `pyramid-${suffix}-${index}`,
      displayName: `Pyramid User ${index}`,
      club: { create: { name: `Pyramid Club ${index}`, slug: `pyramid-${suffix}-${index}` } },
      wallets: { create: [{ asset: "CASH", balance: 1000n }, { asset: "GOLD", balance: 1000n }] },
    },
    include: { club: true },
  });
  await prisma.player.createMany({
    data: positions.map((position, slot) => ({
      clubId: user.club!.id,
      firstName: `P${slot}`,
      lastName: `C${index}`,
      nationality: "IR",
      age: 23,
      position,
      overall: 60 + index,
      potential: 80,
      attributes: { pace: 60, shooting: 60, passing: 60, dribbling: 60, defending: 60, physical: 60, goalkeeping: position === "GK" ? 70 : 20 },
      wage: 50n,
      contractDays: 300,
      lineupSlot: slot + 1,
    })),
  });
  return { userId: user.id, clubId: user.club!.id };
}

test("national pyramid waits for exactly eight applications before creating a league", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const clubs: Array<{ userId: string; clubId: string }> = [];
  try {
    for (let index = 0; index < 8; index++) clubs.push(await makePyramidClub(suffix, index));
    for (const club of clubs.slice(0, 7)) {
      const result = await applyForPyramidLeague(club.userId, 1, new Date("2026-11-15T12:00:00.000Z"));
      assert.equal(result.status, "QUEUED");
      assert.equal(result.waitingTeams, clubs.indexOf(club) + 1);
    }
    assert.equal(await prisma.pyramidLeague.count({ where: { tier: 1, season: 2027 } }), 0);
    const eighth = await applyForPyramidLeague(clubs[7]!.userId, 1, new Date("2026-11-15T12:00:00.000Z"));
    assert.equal(eighth.status, "ASSIGNED");
    assert.equal(eighth.teams, 8);
    assert.equal(eighth.fixturesCreated, 28);
    const league = await prisma.pyramidLeague.findFirstOrThrow({
      where: { tier: 1, season: 2027 },
      include: { competition: true, entries: true },
    });
    assert.equal(league.entries.length, 8);
    assert.equal(league.competition.maxTeams, 8);
    assert.equal(league.competition.status, "ACTIVE");
    assert.equal(await prisma.footballMatch.count({ where: { competitionId: league.competitionId } }), 28);
    assert.equal(await prisma.pyramidLeagueApplication.count({ where: { tier: 1, season: 2027, status: "ASSIGNED" } }), 8);
    const details = await getPyramidLeagueDetails(clubs[0]!.userId, league.id);
    assert.equal(details.standings.length, 8);
    assert.equal(details.league.tierName, "لیگ پایه");
  } finally {
    const clubIds = clubs.map((club) => club.clubId);
    const userIds = clubs.map((club) => club.userId);
    if (clubIds.length) {
      await prisma.footballMatch.deleteMany({ where: { OR: [{ homeClubId: { in: clubIds } }, { awayClubId: { in: clubIds } }] } });
      await prisma.competition.deleteMany({ where: { createdByClubId: { in: clubIds } } });
      await prisma.pyramidLeagueApplication.deleteMany({ where: { clubId: { in: clubIds } } });
      await prisma.pyramidLeagueEntry.deleteMany({ where: { clubId: { in: clubIds } } });
      await prisma.player.deleteMany({ where: { clubId: { in: clubIds } } });
      await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    }
    if (userIds.length) {
      await prisma.ledgerTransaction.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
});


test("friendly challenge creation enforces three free and two Gold-funded daily uses", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const club = await makePyramidClub(suffix, 0);
  try {
    const assets: string[] = [];
    for (let index = 0; index < 5; index++) {
      const result = await createFriendlyChallenge(club.userId, 100n, new Date("2026-11-15T12:00:00.000Z"));
      assets.push(result.asset);
    }
    assert.deepEqual(assets, ["FREE", "FREE", "FREE", "GOLD", "GOLD"]);
    await assert.rejects(
      createFriendlyChallenge(club.userId, 100n, new Date("2026-11-15T12:00:00.000Z")),
      (error: unknown) => error instanceof Error && error.message === "DAILY_CHALLENGE_LIMIT_REACHED",
    );
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId_asset: { userId: club.userId, asset: "GOLD" } } });
    assert.equal(wallet.balance, 800n);
    const usage = await prisma.challengeDailyUsage.findUniqueOrThrow({
      where: { userId_usageDate: { userId: club.userId, usageDate: new Date("2026-11-15T00:00:00.000Z") } },
    });
    assert.equal(usage.freeUsed, 3);
    assert.equal(usage.goldUsed, 2);
  } finally {
    await prisma.friendlyChallenge.deleteMany({ where: { creatorUserId: club.userId } });
    await prisma.challengeDailyUsage.deleteMany({ where: { userId: club.userId } });
    await prisma.ledgerTransaction.deleteMany({ where: { userId: club.userId } });
    await prisma.player.deleteMany({ where: { clubId: club.clubId } });
    await prisma.club.deleteMany({ where: { id: club.clubId } });
    await prisma.wallet.deleteMany({ where: { userId: club.userId } });
    await prisma.user.deleteMany({ where: { id: club.userId } });
  }
});


test("group friendly challenges can only be accepted by another member of that Telegram group", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const creator = await makePyramidClub(suffix, 0);
  const opponent = await makePyramidClub(suffix, 1);
  const group = await prisma.telegramGroup.create({ data: { telegramId: "-100" + suffix.slice(0, 10), title: "Pyramid Test Group" } });
  let matchId: string | undefined;
  try {
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: creator.userId, role: "MEMBER" } });
    const invite = await createFriendlyChallenge(creator.userId, 100n, new Date("2026-11-15T12:00:00.000Z"), group.telegramId);
    await assert.rejects(
      import("../src/game/league-pyramid-service.js").then((service) => service.acceptFriendlyChallenge(opponent.userId, invite.challenge.token)),
      (error: unknown) => error instanceof Error && error.message === "GROUP_MEMBERSHIP_REQUIRED",
    );
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: opponent.userId, role: "MEMBER" } });
    const accepted = await import("../src/game/league-pyramid-service.js").then((service) => service.acceptFriendlyChallenge(opponent.userId, invite.challenge.token));
    matchId = accepted.match.id;
    assert.equal(accepted.match.homeClubId, creator.clubId);
    assert.equal(accepted.match.awayClubId, opponent.clubId);
    const challenge = await prisma.friendlyChallenge.findUniqueOrThrow({ where: { id: invite.challenge.id } });
    assert.equal(challenge.status, "ACCEPTED");
  } finally {
    if (matchId) await prisma.footballMatch.deleteMany({ where: { id: matchId } });
    await prisma.friendlyChallenge.deleteMany({ where: { creatorUserId: creator.userId } });
    await prisma.groupMembership.deleteMany({ where: { groupId: group.id } });
    await prisma.telegramGroup.delete({ where: { id: group.id } });
    for (const club of [creator, opponent]) {
      await prisma.challengeDailyUsage.deleteMany({ where: { userId: club.userId } });
      await prisma.ledgerTransaction.deleteMany({ where: { userId: club.userId } });
      await prisma.player.deleteMany({ where: { clubId: club.clubId } });
      await prisma.club.deleteMany({ where: { id: club.clubId } });
      await prisma.wallet.deleteMany({ where: { userId: club.userId } });
      await prisma.user.deleteMany({ where: { id: club.userId } });
    }
  }
});

