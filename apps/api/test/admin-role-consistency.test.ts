import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";

test("database admin role revocation overrides environment-scoped role map in league admin routes", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const previousSecret = process.env.BOT_API_SECRET;
  const previousMap = process.env.GAME_ADMIN_ROLE_MAP;
  const telegramId = String(700_000_000 + Math.floor(Math.random() * 100_000_000));
  const secret = "test-admin-role-consistency-secret";
  process.env.BOT_API_SECRET = secret;
  process.env.GAME_ADMIN_ROLE_MAP = JSON.stringify({ [telegramId]: "football" });
  const user = await prisma.user.create({ data: { telegramId, displayName: "Admin role test" } });
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await prisma.adminRoleAssignment.deleteMany({ where: { telegramId } });
    await prisma.user.delete({ where: { id: user.id } });
    await app.close();
    if (previousSecret === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previousSecret;
    if (previousMap === undefined) delete process.env.GAME_ADMIN_ROLE_MAP;
    else process.env.GAME_ADMIN_ROLE_MAP = previousMap;
  });

  await prisma.adminRoleAssignment.create({
    data: { telegramId, role: "football", active: true, createdByTelegramId: "test", updatedByTelegramId: "test" },
  });
  const headers = { "x-football-bot-secret": secret, "x-telegram-user-id": telegramId };
  process.env.BOT_API_SECRET = secret;
  process.env.GAME_ADMIN_ROLE_MAP = JSON.stringify({ [telegramId]: "football" });
  const granted = await app.inject({ method: "GET", url: "/v1/admin/pyramid-leagues", headers });
  assert.equal(granted.statusCode, 200);

  await prisma.adminRoleAssignment.update({ where: { telegramId }, data: { active: false } });
  process.env.BOT_API_SECRET = secret;
  process.env.GAME_ADMIN_ROLE_MAP = JSON.stringify({ [telegramId]: "football" });
  const revoked = await app.inject({ method: "GET", url: "/v1/admin/pyramid-leagues", headers });
  assert.equal(revoked.statusCode, 403);
});
