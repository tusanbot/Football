import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../src/db.js";
import { getMatchFallbackPlan, saveMatchFallbackPlan, MatchFallbackPlanError } from "../src/game/match-fallback-service.js";
import {
  createFriendlyMatch, createLeague, getLeague, joinLeague, listClubMatches,
  simulateScheduledMatch, startLeague, submitMatchCheckpointDecision, claimDueMatchRuntimes,
  releaseMatchRuntimeLease, processDueMatchRuntimes, updateCompetitionRules,
} from "../src/game/match-service.js";

const positions = ["GK","RB","CB","CB","LB","CDM","CM","CAM","RW","ST","LW"] as const;
const squadPositions = [...positions, "GK", "CB", "RB", "LB", "CM", "ST", "RW"] as const;
async function makeClub(suffix: string, index: number) {
  const user = await prisma.user.create({
    data: {
      telegramId: `match-${suffix}-${index}`, displayName: `Match User ${index}`,
      club: { create: { name: `Match Club ${index}`, slug: `match-${suffix}-${index}`, stadiumLevel: 2, ticketPrice: 45n } },
      wallets: { create: [{ asset: "CASH", balance: 1000n }, { asset: "GOLD", balance: 10n }] },
    }, include: { club: true },
  });
  const clubId = user.club!.id;
  await prisma.player.createMany({ data: squadPositions.map((position, slot) => ({
    clubId, firstName: `Player${slot}`, lastName: `Club${index}`, nationality: "IR",
    age: 22 + (slot % 8), position, overall: 55 + index * 3, potential: 75 + index * 2,
    attributes: {
      pace: 60 + index * 3, shooting: 60 + index * 3, passing: 60 + index * 3,
      dribbling: 60 + index * 3, defending: 60 + index * 3, physical: 60 + index * 3,
      goalkeeping: position === "GK" ? 70 + index * 2 : 25,
    },
    wage: 100n, contractDays: 300, morale: 75, fitness: 95, lineupSlot: slot < positions.length ? slot + 1 : null,
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
    const benchBefore = await prisma.player.findMany({
      where: { clubId: { in: clubs.map((club) => club.clubId) }, lineupSlot: null },
      select: { id: true, fitness: true },
    });
    const result = await simulateScheduledMatch(clubs[0]!.userId, created.match.id);
    assert.equal(result.replayed, false);
    assert.ok((result.homeScore ?? -1) >= 0);
    assert.ok((result.awayScore ?? -1) >= 0);
    assert.ok((result.events?.length ?? 0) >= 0);
    const match = await prisma.footballMatch.findUniqueOrThrow({ where: { id: created.match.id } });
    assert.equal(match.status, "COMPLETED");
    assert.equal(match.simulationVersion, 1);
    assert.equal(await prisma.matchEvent.count({ where: { matchId: match.id } }), result.events?.length ?? 0);
    assert.equal(await prisma.playerMatchPerformance.count({ where: { matchId: match.id } }), 36);
    assert.ok(await prisma.matchEvent.count({ where: { matchId: match.id, type: "SUBSTITUTION" } }) > 0);
    assert.ok(await prisma.playerMatchPerformance.count({ where: { matchId: match.id, minutesPlayed: { gt: 0, lt: 90 } } }) > 0);
    const benchAfter = await prisma.player.findMany({
      where: { id: { in: benchBefore.map((player) => player.id) } },
      select: { id: true, fitness: true },
    });
    assert.ok(benchAfter.some((player) => player.fitness < (benchBefore.find((beforePlayer) => beforePlayer.id === player.id)?.fitness ?? 100)));
    const after = await prisma.wallet.findUniqueOrThrow({
      where: { userId_asset: { userId: clubs[0]!.userId, asset: "CASH" } },
    });
    assert.ok(after.balance > before.balance);
    const replay = await simulateScheduledMatch(clubs[1]!.userId, match.id);
    assert.equal(replay.replayed, true);
    assert.equal(replay.homeScore, result.homeScore);
    assert.equal(replay.events?.length, result.events?.length);
    assert.equal(await prisma.ledgerTransaction.count({ where: { referenceType: "FOOTBALL_MATCH", referenceId: match.id } }), 3);
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
    await assert.rejects(
      createLeague(clubs[0]!.userId, "Invalid penalty league", 4, `league-penalty-${suffix}`, "LEAGUE", {
        maxSubstitutions: 5, maxInPlayWindows: 3, injuriesEnabled: true, injuryDurationDays: 5,
        redCardSuspensionMatches: 1, yellowCardsToSuspend: 3,
        yellowCardSuspensionMatches: 1, penaltiesOnDraw: true,
      }),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "PENALTIES_NOT_ALLOWED_FOR_LEAGUE",
    );
    const customRules = {
      maxSubstitutions: 4, maxInPlayWindows: 2, injuriesEnabled: false, injuryDurationDays: 7,
      redCardSuspensionMatches: 2, yellowCardsToSuspend: 4,
      yellowCardSuspensionMatches: 2, penaltiesOnDraw: false,
    };
    const savedRules = await updateCompetitionRules(clubs[0]!.userId, competitionId, customRules);
    assert.deepEqual(savedRules.rules, customRules);
    for (const member of clubs.slice(1)) {
      const joined = await joinLeague(member.userId, competitionId);
      assert.equal(joined.joined, true);
    }
    const started = await startLeague(clubs[0]!.userId, competitionId, new Date());
    assert.equal(started.teams, 4);
    assert.equal(started.fixturesCreated, 6);
    await assert.rejects(
      updateCompetitionRules(clubs[0]!.userId, competitionId, customRules),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error
        && error.code === "COMPETITION_RULES_LOCKED",
    );
    const startReplay = await startLeague(clubs[0]!.userId, competitionId, new Date());
    assert.equal(startReplay.replayed, true);
    assert.equal(startReplay.fixturesCreated, 6);
    const fixtures = await prisma.footballMatch.findMany({ where: { competitionId }, orderBy: { scheduledAt: "asc" } });
    assert.equal(fixtures.length, 6);
    for (const fixture of fixtures) {
      assert.deepEqual(fixture.rulesSnapshot, customRules);
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

test("knockout cup fills its bracket, advances winners and crowns a champion", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const clubs: Array<{ userId: string; clubId: string }> = [];
  let competitionId: string | undefined;
  try {
    for (let i = 0; i < 4; i++) clubs.push(await makeClub(suffix, i + 10));
    const created = await createLeague(
      clubs[0]!.userId, `Test Cup ${suffix.slice(0, 6)}`, 4, `cup-create-${suffix}`, "CUP",
    );
    competitionId = created.competition.id;
    assert.equal(created.competition.format, "CUP");
    assert.equal((created.competition.rules as { penaltiesOnDraw:boolean }).penaltiesOnDraw, true);
    for (const member of clubs.slice(1)) await joinLeague(member.userId, competitionId);
    const started = await startLeague(clubs[0]!.userId, competitionId, new Date());
    assert.equal(started.fixturesCreated, 2);
    assert.equal(started.rounds, 2);
    const firstRound = await prisma.footballMatch.findMany({
      where: { competitionId, round: 1 }, orderBy: { scheduledAt: "asc" },
    });
    assert.equal(firstRound.length, 2);
    assert.ok(firstRound.every((fixture) => (fixture.rulesSnapshot as { penaltiesOnDraw:boolean }).penaltiesOnDraw));
    for (const fixture of firstRound) {
      const owner = clubs.find((club) => club.clubId === fixture.homeClubId || club.clubId === fixture.awayClubId)!;
      await simulateScheduledMatch(owner.userId, fixture.id, new Date(fixture.scheduledAt.getTime() + 60_000));
    }
    const finalFixture = await prisma.footballMatch.findFirstOrThrow({ where: { competitionId, round: 2 } });
    const finalOwner = clubs.find((club) => club.clubId === finalFixture.homeClubId || club.clubId === finalFixture.awayClubId)!;
    const finalResult = await simulateScheduledMatch(finalOwner.userId, finalFixture.id, new Date(finalFixture.scheduledAt.getTime() + 60_000));
    assert.ok(finalResult.winnerClubId);
    const details = await getLeague(clubs[0]!.userId, competitionId);
    assert.equal(details.competition.format, "CUP");
    assert.equal(details.competition.status, "COMPLETED");
    assert.equal(details.matches.length, 3);
    assert.equal(details.matches.every((match) => match.status === "COMPLETED"), true);
    assert.equal(details.matches.every((match) => match.winnerClubId), true);
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

test("two-legged knockout cup waits for both legs and advances on aggregate score", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const clubs: Array<{ userId: string; clubId: string }> = [];
  let competitionId: string | undefined;
  try {
    for (let i = 0; i < 4; i++) clubs.push(await makeClub(suffix, i + 60));
    const created = await createLeague(
      clubs[0]!.userId, `Two Leg Cup ${suffix.slice(0, 6)}`, 4,
      `two-leg-cup-${suffix}`, "CUP", undefined, 2,
    );
    competitionId = created.competition.id;
    assert.equal(created.competition.cupLegs, 2);
    for (const member of clubs.slice(1)) await joinLeague(member.userId, competitionId);
    const started = await startLeague(clubs[0]!.userId, competitionId, new Date());
    assert.equal(started.fixturesCreated, 4);
    assert.equal(started.cupLegs, 2);
    const firstRound = await prisma.footballMatch.findMany({
      where: { competitionId, round: 1 }, orderBy: [{ tieId: "asc" }, { leg: "asc" }],
    });
    assert.equal(firstRound.length, 4);
    assert.deepEqual(firstRound.map((fixture) => fixture.leg), [1, 2, 1, 2]);
    assert.equal(new Set(firstRound.map((fixture) => fixture.tieId)).size, 2);
    for (const fixture of firstRound.filter((item) => item.leg === 1)) {
      const owner = clubs.find((club) => club.clubId === fixture.homeClubId)!;
      const result = await simulateScheduledMatch(owner.userId, fixture.id, new Date(fixture.scheduledAt.getTime() + 60_000));
      assert.equal(result.winnerClubId, null);
    }
    assert.equal(await prisma.footballMatch.count({ where: { competitionId, round: 2 } }), 0);
    for (const fixture of firstRound.filter((item) => item.leg === 2)) {
      const owner = clubs.find((club) => club.clubId === fixture.homeClubId)!;
      await simulateScheduledMatch(owner.userId, fixture.id, new Date(fixture.scheduledAt.getTime() + 60_000));
    }
    const secondRound = await prisma.footballMatch.findMany({
      where: { competitionId, round: 2 }, orderBy: [{ tieId: "asc" }, { leg: "asc" }],
    });
    assert.equal(secondRound.length, 2);
    assert.deepEqual(secondRound.map((fixture) => fixture.leg), [1, 2]);
    assert.equal(new Set(secondRound.map((fixture) => fixture.tieId)).size, 1);
    for (const fixture of secondRound) {
      const owner = clubs.find((club) => club.clubId === fixture.homeClubId)!;
      await simulateScheduledMatch(owner.userId, fixture.id, new Date(fixture.scheduledAt.getTime() + 60_000));
    }
    const details = await getLeague(clubs[0]!.userId, competitionId);
    assert.equal(details.competition.status, "COMPLETED");
    assert.equal(details.matches.length, 6);
    assert.ok(details.matches.every((match) => match.status === "COMPLETED"));
    const finalTie = details.matches.filter((match) => match.round === 2);
    const finalFirstLeg = finalTie.find((match) => match.leg === 1)!;
    const finalSecondLeg = finalTie.find((match) => match.leg === 2)!;
    assert.ok(finalSecondLeg.winnerClubId);
    assert.equal(finalFirstLeg.winnerClubId, null);
    assert.equal(finalSecondLeg.aggregateHomeScore, finalSecondLeg.homeScore! + finalFirstLeg.awayScore!);
    assert.equal(finalSecondLeg.aggregateAwayScore, finalSecondLeg.awayScore! + finalFirstLeg.homeScore!);
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

test("checkpoint decisions persist idempotently and runtime leases recover after expiry", async (t) => {
 if (!process.env.DATABASE_URL) { t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job."); return; }
 const suffix=randomUUID().replaceAll("-",""), clubs:Array<{userId:string;clubId:string}>=[];
 try {
  clubs.push(await makeClub(suffix,20),await makeClub(suffix,21));
  const created=await createFriendlyMatch(clubs[0]!.userId,clubs[1]!.clubId,`checkpoint-${suffix}`,new Date(Date.now()+60000));
  const now=new Date();
  await prisma.matchRuntime.create({data:{matchId:created.match.id,status:"AWAITING_CHECKPOINT",currentMinute:45,nextActionAt:new Date(now.getTime()-1)}});
  await prisma.matchTacticalCheckpoint.create({data:{matchId:created.match.id,checkpointKey:"half-time-v1",kind:"HALF_TIME",minute:45,
   openedAt:new Date(now.getTime()-10000),decisionDeadlineAt:new Date(now.getTime()+20000),nextSegmentAt:new Date(now.getTime()+30000)}});
  const first=await submitMatchCheckpointDecision(clubs[0]!.userId,created.match.id,"half-time-v1",`decision-${suffix}`,{tempo:"FAST"},now);
  assert.equal(first.replayed,false); assert.deepEqual(first.decision.instruction,{tempo:"FAST"});
  const replay=await submitMatchCheckpointDecision(clubs[0]!.userId,created.match.id,"half-time-v1",`decision-${suffix}`,{tempo:"FAST"},now);
  assert.equal(replay.replayed,true);
  const claimed=await claimDueMatchRuntimes("worker-a",now,30000,10); assert.equal(claimed.length,1);
  assert.equal((await claimDueMatchRuntimes("worker-b",now,30000,10)).length,0);
  await prisma.matchRuntime.update({where:{matchId:created.match.id},data:{leaseExpiresAt:new Date(now.getTime()-1)}});
  const recovered=await claimDueMatchRuntimes("worker-b",now,30000,10); assert.equal(recovered.length,1);
  assert.equal(await releaseMatchRuntimeLease(claimed[0]!.runtime.id,claimed[0]!.lease.token,null),false);
  assert.equal(await releaseMatchRuntimeLease(recovered[0]!.runtime.id,recovered[0]!.lease.token,null),true);
 } finally {
  const clubIds=clubs.map(c=>c.clubId);
  if(clubIds.length){await prisma.footballMatch.deleteMany({where:{OR:[{homeClubId:{in:clubIds}},{awayClubId:{in:clubIds}}]}});
   await prisma.player.deleteMany({where:{clubId:{in:clubIds}}});await prisma.club.deleteMany({where:{id:{in:clubIds}}});}
  const userIds=clubs.map(c=>c.userId);
  if(userIds.length){await prisma.ledgerTransaction.deleteMany({where:{userId:{in:userIds}}});
   await prisma.wallet.deleteMany({where:{userId:{in:userIds}}});await prisma.user.deleteMany({where:{id:{in:userIds}}});}
 }
});


test("durable match worker advances checkpoints, resumes on two early decisions and settles once", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const clubs: Array<{ userId: string; clubId: string }> = [];
  try {
    clubs.push(await makeClub(suffix, 40), await makeClub(suffix, 41));
    const kickoff = new Date(Date.now() - 30_000);
    const created = await createFriendlyMatch(
      clubs[0]!.userId, clubs[1]!.clubId, `runtime-${suffix}`, kickoff,
    );
    await prisma.footballMatch.update({
      where: { id: created.match.id },
      data: {
        seed: "runtime-injury-red0-90",
        rulesSnapshot: {
          maxSubstitutions: 5, maxInPlayWindows: 3, injuriesEnabled: true, injuryDurationDays: 9,
          redCardSuspensionMatches: 2, yellowCardsToSuspend: 3,
          yellowCardSuspensionMatches: 1, penaltiesOnDraw: false,
        },
      },
    });
    const firstTick = await processDueMatchRuntimes("test-runtime-worker", kickoff, 5);
    assert.equal(firstTick.enqueued, 1);
    assert.equal(firstTick.advanced, 1);
    const firstRuntime = await prisma.matchRuntime.findUniqueOrThrow({ where: { matchId: created.match.id } });
    const firstState = firstRuntime.simulationState as {
      segment: { events: Array<{ type: string; minute: number; playerId: string; detail: string }>; home: { side: { players: Array<{ id: string; position: string }> } } };
      substitutions: { home: { substitutionsUsed: number; inPlayWindowsUsed: number; sentOffIds: string[] } };
    };
    const injuryEvent = firstState.segment.events.find((event) => event.type === "INJURY");
    const redCardEvent = firstState.segment.events.find((event) => event.type === "RED_CARD");
    assert.ok(injuryEvent);
    assert.ok(redCardEvent);
    assert.ok(firstState.segment.events.some((event) =>
      event.type === "SUBSTITUTION" && event.minute === injuryEvent.minute && event.detail.includes("Forced injury")));
    assert.equal(firstState.substitutions.home.substitutionsUsed, 1);
    assert.equal(firstState.substitutions.home.inPlayWindowsUsed, 1);
    const listedMatches = await listClubMatches(clubs[0]!.userId);
    const listedRuntime = listedMatches.matches.find((item) => item.id === created.match.id)?.runtime;
    assert.equal(listedRuntime?.mySubstitutionsUsed, firstState.substitutions.home.substitutionsUsed);
    assert.equal(listedRuntime?.lineups?.home.players.length, 11);
    assert.ok(listedRuntime?.lineups?.home.tactics.mentality);
    assert.ok(firstState.substitutions.home.sentOffIds.includes(redCardEvent.playerId));
    const halfTime = await prisma.matchTacticalCheckpoint.findUniqueOrThrow({
      where: { matchId_checkpointKey: { matchId: created.match.id, checkpointKey: "minute-45" } },
    });
    assert.equal(halfTime.status, "OPEN");
    const decisionTime = new Date(kickoff.getTime() + 7_000);
    const homeRoster = await prisma.player.findMany({
      where: { clubId: clubs[0]!.clubId }, select: { id: true, position: true, lineupSlot: true },
    });
    const activeHomeIds = new Set(firstState.segment.home.side.players.map((player) => player.id));
    const outgoing = homeRoster.find((player) => activeHomeIds.has(player.id) && player.position === "ST")!;
    const incoming = homeRoster.find((player) => player.lineupSlot === null && player.position === "ST" && !activeHomeIds.has(player.id))!;
    await submitMatchCheckpointDecision(
      clubs[0]!.userId, created.match.id, "minute-45", `decision-home-${suffix}`,
      {
        mentality: "ATTACKING", tempo: "FAST",
        substitutions: [{ outgoingPlayerId: outgoing.id, incomingPlayerId: incoming.id }],
      }, decisionTime,
    );
    await submitMatchCheckpointDecision(
      clubs[1]!.userId, created.match.id, "minute-45", `decision-away-${suffix}`,
      { mentality: "DEFENSIVE", pressing: "LOW_BLOCK" }, decisionTime,
    );
    const resumed = await processDueMatchRuntimes(
      "test-runtime-worker", new Date(kickoff.getTime() + 10_000), 5,
    );
    assert.equal(resumed.advanced, 1);
    const minute60 = await prisma.matchTacticalCheckpoint.findUniqueOrThrow({
      where: { matchId_checkpointKey: { matchId: created.match.id, checkpointKey: "minute-60" } },
    });
    assert.equal(minute60.status, "OPEN");
    const minute75Tick = await processDueMatchRuntimes(
      "test-runtime-worker", new Date(kickoff.getTime() + 70_000), 5,
    );
    assert.equal(minute75Tick.advanced, 1);
    const fullTimeTick = await processDueMatchRuntimes(
      "test-runtime-worker", new Date(kickoff.getTime() + 130_000), 5,
    );
    assert.equal(fullTimeTick.settled, 1);
    const [match, runtime, checkpoints] = await Promise.all([
      prisma.footballMatch.findUniqueOrThrow({ where: { id: created.match.id } }),
      prisma.matchRuntime.findUniqueOrThrow({ where: { matchId: created.match.id } }),
      prisma.matchTacticalCheckpoint.findMany({ where: { matchId: created.match.id }, orderBy: { minute: "asc" } }),
    ]);
    assert.equal(match.status, "COMPLETED");
    assert.equal(runtime.status, "COMPLETED");
    assert.equal(runtime.currentMinute, 90);
    const finalRuntimeState = runtime.simulationState as {
      segment: { playerStats: Array<{ playerId:string; minutesPlayed:number; shots:number; passes:number; tackles:number; fitnessLoss:number }> };
    };
    const sampleStats = finalRuntimeState.segment.playerStats.find((item) => item.minutesPlayed > 20)!;
    const samplePerformance = await prisma.playerMatchPerformance.findFirstOrThrow({
      where: { matchId: match.id, playerId: sampleStats.playerId },
    });
    assert.equal(samplePerformance.minutesPlayed, sampleStats.minutesPlayed);
    assert.ok(samplePerformance.shots >= sampleStats.shots);
    assert.equal(samplePerformance.passes, sampleStats.passes);
    assert.equal(samplePerformance.tackles, sampleStats.tackles);
    assert.equal(samplePerformance.fitnessLoss, sampleStats.fitnessLoss);
    assert.deepEqual(checkpoints.map((item) => item.status), ["RESOLVED", "RESOLVED", "RESOLVED"]);
    const minute60Resolution = checkpoints[1]!.resolution as { home: { source: string }; away: { source: string } };
    const minute75Resolution = checkpoints[2]!.resolution as { home: { source: string }; away: { source: string } };
    assert.equal(minute60Resolution.home.source, "PREMATCH_PLAN");
    assert.equal(minute60Resolution.away.source, "PREMATCH_PLAN");
    assert.equal(minute75Resolution.home.source, "PREMATCH_PLAN");
    assert.equal(minute75Resolution.away.source, "PREMATCH_PLAN");
    assert.ok(await prisma.matchEvent.count({ where: { matchId: match.id, type: "SUBSTITUTION" } }) >= 1);
    assert.equal(await prisma.matchEvent.count({ where: { matchId: match.id } }),
      match.homeScore! + match.awayScore!
      + await prisma.matchEvent.count({ where: { matchId: match.id, type: "YELLOW_CARD" } })
      + await prisma.matchEvent.count({ where: { matchId: match.id, type: "RED_CARD" } })
      + await prisma.matchEvent.count({ where: { matchId: match.id, type: "INJURY" } })
      + await prisma.matchEvent.count({ where: { matchId: match.id, type: "SUBSTITUTION" } }));
    const injuryPerformance = await prisma.playerMatchPerformance.findFirstOrThrow({
      where: { matchId: match.id, playerId: injuryEvent.playerId },
    });
    const redCardPerformance = await prisma.playerMatchPerformance.findFirstOrThrow({
      where: { matchId: match.id, playerId: redCardEvent.playerId },
    });
    assert.equal(injuryPerformance.minutesPlayed, injuryEvent.minute);
    assert.equal(redCardPerformance.minutesPlayed, redCardEvent.minute);
    assert.equal(redCardPerformance.redCards, 1);
    const injuredPlayer = await prisma.player.findUniqueOrThrow({ where: { id: injuryEvent.playerId } });
    assert.equal(injuredPlayer.status, "INJURED");
    assert.equal(injuredPlayer.injuryUntil?.getTime(), match.completedAt!.getTime() + 9 * 86_400_000);
    const sentOffPlayer = await prisma.player.findUniqueOrThrow({ where: { id: redCardEvent.playerId } });
    assert.equal(sentOffPlayer.suspensionMatchesRemaining, 2);
    const nextFixture = await createFriendlyMatch(
      clubs[0]!.userId, clubs[1]!.clubId, `after-red-card-${suffix}`,
      new Date(Date.now() - 1_000),
    );
    await simulateScheduledMatch(clubs[0]!.userId, nextFixture.match.id);
    const suspendedPlayerPerformance = await prisma.playerMatchPerformance.findFirst({
      where: { matchId: nextFixture.match.id, playerId: redCardEvent.playerId },
    });
    assert.equal(suspendedPlayerPerformance, null);
    const servedSuspension = await prisma.player.findUniqueOrThrow({ where: { id: redCardEvent.playerId } });
    assert.equal(servedSuspension.suspensionMatchesRemaining, 1);
    const replay = await simulateScheduledMatch(clubs[1]!.userId, match.id);
    assert.equal(replay.replayed, true);
    assert.equal(await prisma.ledgerTransaction.count({
      where: { referenceType: "FOOTBALL_MATCH", referenceId: match.id },
    }), 3);
  } finally {
    const clubIds = clubs.map((club) => club.clubId);
    if (clubIds.length) {
      await prisma.footballMatch.deleteMany({
        where: { OR: [{ homeClubId: { in: clubIds } }, { awayClubId: { in: clubIds } }] },
      });
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


test("club fallback plan is versioned and frozen into the kickoff runtime snapshot", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const clubs: Array<{ userId: string; clubId: string }> = [];
  try {
    clubs.push(await makeClub(suffix, 80), await makeClub(suffix, 81));
    const initial = await getMatchFallbackPlan(clubs[0]!.userId);
    assert.equal(initial.isCustom, false);
    assert.equal(initial.version, 1);
    const plan = {
      formation: "4-4-2",
      mentality: "DEFENSIVE" as const,
      pressing: "LOW_BLOCK" as const,
      tempo: "SLOW" as const,
      passingStyle: "SHORT" as const,
    };
    const saved = await saveMatchFallbackPlan(clubs[0]!.userId, plan, initial.version);
    assert.equal(saved.version, 2);
    assert.equal(saved.isCustom, true);
    await assert.rejects(
      saveMatchFallbackPlan(clubs[0]!.userId, plan, initial.version),
      (error: unknown) => error instanceof MatchFallbackPlanError
        && error.code === "FALLBACK_PLAN_VERSION_CONFLICT",
    );
    const kickoff = new Date();
    const created = await createFriendlyMatch(
      clubs[0]!.userId, clubs[1]!.clubId, `fallback-runtime-${suffix}`,
      new Date(kickoff.getTime() - 1_000),
    );
    const tick = await processDueMatchRuntimes("fallback-plan-test-worker", kickoff, 5);
    assert.equal(tick.enqueued, 1);
    assert.equal(tick.advanced, 1);
    const runtime = await prisma.matchRuntime.findUniqueOrThrow({ where: { matchId: created.match.id } });
    const snapshot = runtime.fallbackPlan as { home: Record<string, string>; away: Record<string, string> };
    assert.deepEqual(snapshot.home, plan);
    assert.equal(snapshot.away.formation, "4-3-3");
    assert.equal(snapshot.away.mentality, "BALANCED");
  } finally {
    const clubIds = clubs.map((club) => club.clubId);
    if (clubIds.length) {
      await prisma.footballMatch.deleteMany({
        where: { OR: [{ homeClubId: { in: clubIds } }, { awayClubId: { in: clubIds } }] },
      });
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
