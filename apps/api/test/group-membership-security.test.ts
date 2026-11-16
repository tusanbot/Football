import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/db.js";
import { checkTelegramGroupMembers } from "../src/groups/group-service.js";

test("suspended Telegram groups cannot be reactivated by member-count refresh", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const telegramId = "-100" + String(Date.now()) + String(Math.floor(Math.random() * 1000));
  const group = await prisma.telegramGroup.create({
    data: { telegramId, title: "Suspended group security test", memberCount: 9, isActive: false, isSuspended: true },
  });
  t.after(async () => { await prisma.telegramGroup.delete({ where: { id: group.id } }); });
  const result = await checkTelegramGroupMembers(telegramId, 100, true);
  assert.equal(result.found, true);
  assert.equal(result.isActive, false);
  const stored = await prisma.telegramGroup.findUnique({ where: { id: group.id }, select: { isActive: true, isSuspended: true } });
  assert.deepEqual(stored, { isActive: false, isSuspended: true });
});

