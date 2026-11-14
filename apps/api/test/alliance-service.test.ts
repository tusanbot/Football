import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../src/db.js";
import { AllianceServiceError, closeAllianceSeason, reviewAllianceSeason, startAllianceSeason } from "../src/groups/alliance-service.js";
import { consumeAllianceActionRateLimit } from "../src/groups/alliance-rate-limit.js";

test("alliance season close enforces its end date, calculates seasonal net points and holds suspicious payouts for authorized review", async t => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const reviewerTelegramId = (BigInt("0x" + suffix.slice(0, 12)) + 10000000000n).toString();
  const memberTelegramId = (BigInt("0x" + suffix.slice(12, 24)) + 20000000000n).toString();
  const groupTelegramId = "-100" + (BigInt("0x" + suffix.slice(24, 36)) + 30000000000n).toString();
  const now = new Date();
  const startsAt = new Date(now.getTime() - 3 * 86400000);
  const endsAt = new Date(now.getTime() + 86400000);
  let groupId: string | undefined;
  let allianceId: string | undefined;
  let reviewerId: string | undefined;
  let memberId: string | undefined;
  const previousReviewers = process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS;
  try {
    const reviewer = await prisma.user.create({
      data: { telegramId: reviewerTelegramId, displayName: "Alliance Reviewer", club: { create: { name: "Reviewer FC", slug: "reviewer-" + suffix } } },
    });
    reviewerId = reviewer.id;
    const member = await prisma.user.create({
      data: { telegramId: memberTelegramId, displayName: "Alliance Member", club: { create: { name: "Member FC", slug: "member-" + suffix } } },
    });
    memberId = member.id;
    const group = await prisma.telegramGroup.create({
      data: { telegramId: groupTelegramId, title: "Alliance Security Test", isActive: true, memberCount: 20 },
    });
    groupId = group.id;
    await prisma.groupMembership.createMany({ data: [
      { groupId, userId: reviewer.id, role: "OWNER" },
      { groupId, userId: member.id, role: "MEMBER" },
    ] });
    const alliance = await prisma.alliance.create({
      data: {
        slug: "alliance-test-" + suffix,
        name: "Security Test Alliance",
        createdByGroupId: groupId,
        treasuryPoints: 500n,
        groups: { create: { groupId, role: "FOUNDER", joinedAt: startsAt } },
      },
    });
    allianceId = alliance.id;
    const season = await prisma.allianceSeason.create({
      data: { allianceId, number: 1, startsAt, endsAt },
    });
    await prisma.groupPointLedger.createMany({ data: [
      { idempotencyKey: "security-score-a-" + suffix, groupId, userId: reviewer.id, amount: 100n, source: "GAME_ACTIVITY", description: "eligible season points", createdAt: new Date(now.getTime() - 2 * 86400000) },
      { idempotencyKey: "security-score-b-" + suffix, groupId, userId: member.id, amount: 20n, source: "DAILY_ACTIVITY", description: "eligible season points", createdAt: new Date(now.getTime() - 2 * 86400000) },
      { idempotencyKey: "security-score-admin-" + suffix, groupId, userId: reviewer.id, amount: 5000n, source: "ADMIN_ADJUSTMENT", description: "must not count", createdAt: new Date(now.getTime() - 2 * 86400000) },
    ] });
    await assert.rejects(
      closeAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId: groupTelegramId }),
      (error: unknown) => error instanceof AllianceServiceError && error.code === "SEASON_NOT_ENDED",
    );
    await prisma.allianceSeason.update({ where: { id: season.id }, data: { endsAt: new Date(now.getTime() - 1000) } });
    process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS = reviewerTelegramId;
    const closed = await closeAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId: groupTelegramId });
    assert.equal(closed.reviewStatus, "FLAGGED");
    assert.equal((closed.standings as Array<{ points: string }>)[0]?.points, "120");
    assert.equal((await prisma.alliance.findUniqueOrThrow({ where: { id: allianceId } })).treasuryPoints, 500n);
    assert.equal((await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } })).points, 0n);
    delete process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS;
    await assert.rejects(
      reviewAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId: groupTelegramId, seasonId: season.id, decision: "APPROVE" }),
      (error: unknown) => error instanceof AllianceServiceError && error.code === "ALLIANCE_REVIEWER_REQUIRED",
    );
    await assert.rejects(
      startAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId: groupTelegramId, durationDays: 30 }),
      (error: unknown) => error instanceof AllianceServiceError && error.code === "SEASON_REVIEW_REQUIRED",
    );
    process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS = reviewerTelegramId;
    const reviewed = await reviewAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId: groupTelegramId, seasonId: season.id, decision: "APPROVE" });
    assert.equal(reviewed.reviewStatus, "APPROVED");
    assert.equal(reviewed.prize, "500");
    assert.equal((await prisma.alliance.findUniqueOrThrow({ where: { id: allianceId } })).treasuryPoints, 0n);
    assert.equal((await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } })).points, 500n);
    const replay = await reviewAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId: groupTelegramId, seasonId: season.id, decision: "APPROVE" });
    assert.equal(replay.replayed, true);
    const nextSeason = await startAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId: groupTelegramId, durationDays: 30 });
    assert.equal(nextSeason.season.number, 2);
    assert.equal(await prisma.allianceAuditLog.count({ where: { allianceId } }) >= 3, true);
  } finally {
    if (previousReviewers === undefined) delete process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS;
    else process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS = previousReviewers;
    if (allianceId) await prisma.alliance.deleteMany({ where: { id: allianceId } });
    if (groupId) await prisma.telegramGroup.deleteMany({ where: { id: groupId } });
    if (reviewerId) {
      await prisma.club.deleteMany({ where: { ownerId: reviewerId } });
      await prisma.user.deleteMany({ where: { id: reviewerId } });
    }
    if (memberId) {
      await prisma.club.deleteMany({ where: { ownerId: memberId } });
      await prisma.user.deleteMany({ where: { id: memberId } });
    }
  }
});

test("alliance action limits persist and reset at the next minute boundary",async t=>{
 if(!process.env.DATABASE_URL){t.skip("DATABASE_URL is only configured in ephemeral PostgreSQL CI.");return;}
 const id="alliance-rate-"+randomUUID(),now=new Date("2026-11-14T12:00:00.000Z");
 try{
  assert.equal(await consumeAllianceActionRateLimit({telegramUserId:id,telegramGroupId:"-100123",action:"invite",limit:2,now}),true);
  assert.equal(await consumeAllianceActionRateLimit({telegramUserId:id,telegramGroupId:"-100123",action:"invite",limit:2,now}),true);
  assert.equal(await consumeAllianceActionRateLimit({telegramUserId:id,telegramGroupId:"-100123",action:"invite",limit:2,now}),false);
  assert.equal(await consumeAllianceActionRateLimit({telegramUserId:id,telegramGroupId:"-100123",action:"invite",limit:2,now:new Date(now.getTime()+60000)}),true);
 }finally{await prisma.allianceActionThrottle.deleteMany({where:{key:{startsWith:id}}});}
});
