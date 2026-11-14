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

      const created = await tx.user.create({
        data: {
          telegramId, username, displayName,
          club: { create: { name: `${firstName} FC`, slug: `club-${telegramId}` } },
          wallets: { create: [{ asset: "CASH", balance: 20_000n }, { asset: "GOLD", balance: 50n }] },
        },
        select: {
          id: true, telegramId: true, displayName: true,
          club: { select: { id: true, name: true, level: true, reputation: true } },
          wallets: { select: { asset: true, balance: true } },
        },
      });

      await tx.ledgerTransaction.createMany({
        data: [
          { idempotencyKey: `starter:${telegramId}:CASH`, userId: created.id, asset: "CASH", direction: "CREDIT", amount: 20_000n, reason: "STARTER_GRANT", referenceType: "STARTER_GRANT", referenceId: created.id },
          { idempotencyKey: `starter:${telegramId}:GOLD`, userId: created.id, asset: "GOLD", direction: "CREDIT", amount: 50n, reason: "STARTER_GRANT", referenceType: "STARTER_GRANT", referenceId: created.id },
        ],
      });
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
