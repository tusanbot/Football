import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { ensureStarterSquad } from "../players/player-service.js";

export interface TelegramAccountIdentity {
  telegramId: string;
  username?: string | null;
  displayName: string;
  firstName: string;
}

/**
 * The single provisioning path shared by Mini App initData and authenticated Bot updates.
 * Keeps starter grants, club creation, and squad generation identical across transports.
 */
export async function provisionTelegramAccount(identity: TelegramAccountIdentity) {
  const { telegramId, displayName, username = null, firstName } = identity;

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { telegramId } });
      if (existing) {
        const updated = await tx.user.update({
          where: { id: existing.id },
          data: { username, displayName },
          select: {
            id: true, telegramId: true, displayName: true,
            club: { select: { id: true, name: true, level: true, reputation: true } },
            wallets: { select: { asset: true, balance: true } },
          },
        });
        if (updated.club) await ensureStarterSquad(tx, updated.club.id);
        return updated;
      }

      const starterSettings = await tx.gameSetting.findMany({
        where: { key: { in: ["economy.starterCash", "economy.starterGold"] } },
        select: { key: true, value: true },
      });
      const configuredAmount = (key: string, fallback: number, maximum: number) => {
        const value = starterSettings.find(setting => setting.key === key)?.value;
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : fallback;
      };
      const starterCash = configuredAmount("economy.starterCash", 20_000, 1_000_000_000);
      const starterGold = configuredAmount("economy.starterGold", 50, 1_000_000);
      const created = await tx.user.create({
        data: {
          telegramId, username, displayName,
          club: { create: { name: `${firstName} FC`, slug: `club-${telegramId}` } },
          wallets: { create: [{ asset: "CASH", balance: BigInt(starterCash) }, { asset: "GOLD", balance: BigInt(starterGold) }] },
        },
        select: {
          id: true, telegramId: true, displayName: true,
          club: { select: { id: true, name: true, level: true, reputation: true } },
          wallets: { select: { asset: true, balance: true } },
        },
      });

      const starterLedger = [
        ...(starterCash > 0 ? [{ idempotencyKey: `starter:${telegramId}:CASH`, userId: created.id, asset: "CASH" as const, direction: "CREDIT" as const, amount: BigInt(starterCash), reason: "STARTER_GRANT", referenceType: "STARTER_GRANT", referenceId: created.id }] : []),
        ...(starterGold > 0 ? [{ idempotencyKey: `starter:${telegramId}:GOLD`, userId: created.id, asset: "GOLD" as const, direction: "CREDIT" as const, amount: BigInt(starterGold), reason: "STARTER_GRANT", referenceType: "STARTER_GRANT", referenceId: created.id }] : []),
      ];
      if (starterLedger.length) await tx.ledgerTransaction.createMany({ data: starterLedger });
      if (created.club) await ensureStarterSquad(tx, created.club.id);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    // Two first-time updates for the same Telegram identity can race. Re-read the
    // account after a unique/serialization conflict rather than creating a second club.
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { telegramId } });
        if (!existing) throw error;
        const updated = await tx.user.update({
          where: { id: existing.id },
          data: { username, displayName },
          select: {
            id: true, telegramId: true, displayName: true,
            club: { select: { id: true, name: true, level: true, reputation: true } },
            wallets: { select: { asset: true, balance: true } },
          },
        });
        if (updated.club) await ensureStarterSquad(tx, updated.club.id);
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    throw error;
  }
}
