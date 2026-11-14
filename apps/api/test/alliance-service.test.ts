import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../src/db.js";
import { AllianceServiceError, closeAllianceSeason, reviewAllianceSeason } from "../src/groups/alliance-service.js";

test("alliance season close enforces its end date, calculates seasonal net points and holds suspicious payouts for authorized review", async t => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const reviewerTelegramId = "reviewer-" + suffix;
  const memberTelegramId = "member-" + suffix;
  const groupTelegramId = "-100" + suffix.slice(0, 12);
  const now = new Date();
  const startsAt = new Date(now.getTime() - 3 * 86400000);
  const endsAt = new Date(now.getTime() - 86400000);
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
        groups: { create: { groupId, role: "FOUNDER" } },
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
      closeAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId }),
      (error: unknown) => error instanceof AllianceServiceError && error.code === "SEASON_NOT_ENDED",
    );
    await prisma.allianceSeason.update({ where: { id: season.id }, data: { endsAt: new Date(now.getTime() - 1000) } });
    process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS = reviewerTelegramId;
    const closed = await closeAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId });
    assert.equal(closed.reviewStatus, "FLAGGED");
    assert.equal((closed.standings as Array<{ points: string }>)[0]?.points, "120");
    assert.equal((await prisma.alliance.findUniqueOrThrow({ where: { id: allianceId } })).treasuryPoints, 500n);
    assert.equal((await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } })).points, 0n);
    const reviewed = await reviewAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId, seasonId: season.id, decision: "APPROVE" });
    assert.equal(reviewed.reviewStatus, "APPROVED");
    assert.equal(reviewed.prize, "500");
    assert.equal((await prisma.alliance.findUniqueOrThrow({ where: { id: allianceId } })).treasuryPoints, 0n);
    assert.equal((await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } })).points, 500n);
    const replay = await reviewAllianceSeason({ telegramUserId: reviewerTelegramId, telegramGroupId, seasonId: season.id, decision: "APPROVE" });
    assert.equal(replay.replayed, true);
    assert.equal(await prisma.allianceAuditLog.count({ where: { allianceId } }) >= 2, true);
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
