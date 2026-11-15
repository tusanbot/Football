import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../src/db.js";
import { recordGroupGameActivity, checkTelegramGroupMembers } from "../src/groups/group-service.js";

test("group membership threshold, activity rewards and daily caps use central settings", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const telegramGroupId = "-100" + suffix.slice(0, 15);
  const telegramUserId = "group-settings-" + suffix;
  const keys = ["groups.minimumMembers", "groups.dailyPointCap", "groups.matchPlayedPoints", "groups.challengeJoinPoints"];
  const previous = await prisma.gameSetting.findMany({ where: { key: { in: keys } } });
  let userId: string | undefined, groupId: string | undefined;
  try {
    await prisma.gameSetting.upsert({ where: { key: "groups.minimumMembers" }, create: { key: "groups.minimumMembers", value: 15 }, update: { value: 15 } });
    await prisma.gameSetting.upsert({ where: { key: "groups.dailyPointCap" }, create: { key: "groups.dailyPointCap", value: 5 }, update: { value: 5 } });
    await prisma.gameSetting.upsert({ where: { key: "groups.matchPlayedPoints" }, create: { key: "groups.matchPlayedPoints", value: 4 }, update: { value: 4 } });
    await prisma.gameSetting.upsert({ where: { key: "groups.challengeJoinPoints" }, create: { key: "groups.challengeJoinPoints", value: 2 }, update: { value: 2 } });
    const user = await prisma.user.create({
      data: { telegramId: telegramUserId, displayName: "Group Settings Test", club: { create: { name: "Group Settings FC", slug: "group-settings-" + suffix } } },
    });
    userId = user.id;
    const group = await prisma.telegramGroup.create({ data: { telegramId: telegramGroupId, title: "Group Settings Test", memberCount: 9, isActive: false } });
    groupId = group.id;
    await prisma.groupMembership.create({ data: { groupId, userId, role: "MEMBER" } });
    const belowThreshold = await checkTelegramGroupMembers(telegramGroupId, 10, true);
    assert.equal(belowThreshold.minimumMembers, 15);
    assert.equal(belowThreshold.isActive, false);
    const activated = await checkTelegramGroupMembers(telegramGroupId, 15, true);
    assert.equal(activated.isActive, true);
    const matchAward = await recordGroupGameActivity({ telegramUserId, telegramGroupId, activityType: "MATCH_PLAYED", referenceId: "match-" + suffix });
    assert.equal(matchAward.award, "4");
    const cappedAward = await recordGroupGameActivity({ telegramUserId, telegramGroupId, activityType: "CHALLENGE_JOIN", referenceId: "challenge-" + suffix });
    assert.equal(cappedAward.award, "1");
    const capped = await recordGroupGameActivity({ telegramUserId, telegramGroupId, activityType: "CHALLENGE_CREATE", referenceId: "create-" + suffix });
    assert.equal(capped.capped, true);
    assert.equal((await prisma.telegramGroup.findUniqueOrThrow({ where: { id: groupId } })).points, 5n);
  } finally {
    if (groupId) await prisma.telegramGroup.deleteMany({ where: { id: groupId } });
    if (userId) {
      await prisma.club.deleteMany({ where: { ownerId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    for (const key of keys) {
      const old = previous.find(item => item.key === key);
      if (old) await prisma.gameSetting.update({ where: { key }, data: { value: old.value } });
      else await prisma.gameSetting.deleteMany({ where: { key } });
    }
  }
});
