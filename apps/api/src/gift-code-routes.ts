import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireTelegramUser } from "./auth/require-telegram-user.js";

export function registerGiftCodeRoutes(app: FastifyInstance) {
  app.post("/v1/gift-codes/redeem", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireTelegramUser(req);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });

    const body = z.object({
      code: z.string().trim().min(4).max(32).regex(/^[A-Za-z0-9_-]+$/),
      idempotencyKey: z.string().min(12).max(128),
      telegramGroupId: z.string().regex(/^-?\d{5,20}$/).optional(),
    }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_GIFT_CODE" });

    const code = body.data.code.toUpperCase();
    try {
      return await prisma.$transaction(async (tx) => {
        const gift = await tx.giftCode.findUnique({ where: { code } });
        const now = new Date();
        if (!gift || !gift.active || gift.startsAt > now || (gift.expiresAt && gift.expiresAt <= now)) {
          throw new Error("GIFT_CODE_UNAVAILABLE");
        }

        let group: { id: string; telegramId: string; isActive: boolean; isSuspended: boolean } | null = null;
        if (gift.rewardType === "GROUP_POINTS") {
          if (!body.data.telegramGroupId) throw new Error("GIFT_CODE_GROUP_REQUIRED");
          group = await tx.telegramGroup.findUnique({
            where: { telegramId: body.data.telegramGroupId },
            select: { id: true, telegramId: true, isActive: true, isSuspended: true },
          });
          if (!group || !group.isActive || group.isSuspended) throw new Error("GIFT_CODE_GROUP_UNAVAILABLE");
          const membership = await tx.groupMembership.findUnique({
            where: { groupId_userId: { groupId: group.id, userId: user.id } },
            select: { id: true },
          });
          if (!membership) throw new Error("GIFT_CODE_GROUP_MEMBERSHIP_REQUIRED");
        }

        const idempotencyKey = body.data.idempotencyKey;
        const prior = await tx.giftCodeRedemption.findUnique({ where: { idempotencyKey } });
        if (prior) {
          if (prior.userId === user.id && prior.giftCodeId === gift.id
            && prior.groupId === (group?.id ?? null)) {
            return {
              ok: true,
              reward: { cash: prior.cashAmount.toString(), gold: prior.goldAmount.toString(), groupPoints: prior.groupPoints.toString() },
              replayed: true,
            };
          }
          throw new Error("IDEMPOTENCY_CONFLICT");
        }

        const used = await tx.giftCodeRedemption.count({ where: { giftCodeId: gift.id, userId: user.id } });
        if (used >= gift.perUserLimit) throw new Error("GIFT_CODE_USER_LIMIT");

        const reserved = await tx.giftCode.updateMany({
          where: { id: gift.id, active: true, redeemedCount: { lt: gift.maxRedemptions } },
          data: { redeemedCount: { increment: 1 } },
        });
        if (reserved.count !== 1) throw new Error("GIFT_CODE_EXHAUSTED");

        await tx.giftCodeRedemption.create({
          data: {
            giftCodeId: gift.id, userId: user.id, idempotencyKey,
            cashAmount: gift.cashAmount, goldAmount: gift.goldAmount,
            groupPoints: gift.groupPoints, ...(group ? { groupId: group.id } : {}),
          },
        });

        for (const [asset, amount] of [["CASH", gift.cashAmount], ["GOLD", gift.goldAmount]] as const) {
          if (amount <= 0n) continue;
          await tx.wallet.upsert({
            where: { userId_asset: { userId: user.id, asset } },
            create: { userId: user.id, asset, balance: amount },
            update: { balance: { increment: amount }, version: { increment: 1 } },
          });
          await tx.ledgerTransaction.create({
            data: {
              idempotencyKey: idempotencyKey + ":" + asset, userId: user.id, asset,
              direction: "CREDIT", amount, reason: "GIFT_CODE_REDEMPTION",
              referenceType: "GIFT_CODE", referenceId: gift.id,
            },
          });
        }

        if (gift.rewardType === "GROUP_POINTS" && group && gift.groupPoints > 0n) {
          await tx.telegramGroup.update({
            where: { id: group.id },
            data: { points: { increment: gift.groupPoints } },
          });
          await tx.groupPointLedger.create({
            data: {
              idempotencyKey: idempotencyKey + ":GROUP_POINTS",
              groupId: group.id, userId: user.id, amount: gift.groupPoints,
              source: "GIFT_CODE", description: "Gift code redemption: " + gift.code,
            },
          });
        }

        return {
          ok: true,
          reward: { cash: gift.cashAmount.toString(), gold: gift.goldAmount.toString(), groupPoints: gift.groupPoints.toString() },
        };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof Error && (
        error.message.startsWith("GIFT_CODE_") || error.message === "IDEMPOTENCY_CONFLICT"
      )) return reply.code(409).send({ error: error.message });
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
        return reply.code(409).send({ error: "GIFT_CODE_RETRY" });
      }
      throw error;
    }
  });
}
