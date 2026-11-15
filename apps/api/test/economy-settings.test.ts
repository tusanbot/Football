import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../src/db.js";
import { provisionTelegramAccount } from "../src/auth/account-provisioning-service.js";

test("starter wallet grants use centrally configured economy values", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is only configured in the ephemeral PostgreSQL CI job.");
    return;
  }
  const suffix = randomUUID().replaceAll("-", "");
  const telegramId = "starter-settings-" + suffix;
  const keys = ["economy.starterCash", "economy.starterGold"];
  const previous = await prisma.gameSetting.findMany({ where: { key: { in: keys } } });
  let userId: string | undefined;
  try {
    await prisma.gameSetting.upsert({ where: { key: "economy.starterCash" }, create: { key: "economy.starterCash", value: 12345, updatedByTelegramId: "test-admin" }, update: { value: 12345 } });
    await prisma.gameSetting.upsert({ where: { key: "economy.starterGold" }, create: { key: "economy.starterGold", value: 17, updatedByTelegramId: "test-admin" }, update: { value: 17 } });
    const account = await provisionTelegramAccount({ telegramId, displayName: "Starter Settings Test", firstName: "Starter" });
    userId = account.id;
    assert.equal(account.wallets.find(wallet => wallet.asset === "CASH")?.balance, 12345n);
    assert.equal(account.wallets.find(wallet => wallet.asset === "GOLD")?.balance, 17n);
    const ledger = await prisma.ledgerTransaction.findMany({ where: { userId, referenceType: "STARTER_GRANT" }, orderBy: { asset: "asc" } });
    assert.deepEqual(ledger.map(row => row.amount.toString()).sort(), ["17", "12345"]);
  } finally {
    if (userId) {
      await prisma.club.deleteMany({ where: { ownerId: userId } });
      // Wallet and ledger rows deliberately restrict user deletion in production.
      // Remove only this test account's financial records before deleting it.
      await prisma.ledgerTransaction.deleteMany({ where: { userId } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    for (const key of keys) {
      const old = previous.find(item => item.key === key);
      if (old) await prisma.gameSetting.update({ where: { key }, data: { value: old.value } });
      else await prisma.gameSetting.deleteMany({ where: { key } });
    }
  }
});
