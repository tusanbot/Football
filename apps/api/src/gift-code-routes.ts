import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "./auth/require-telegram-user.js";
import { TelegramGroupAuthorizationError, verifyTelegramGroupActor } from "./groups/telegram-group-authorization.js";
import { getGiftCodeRedemptionPort } from "./gift-code-redemption-context.js";

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

    const redemptionPort = getGiftCodeRedemptionPort();
    if (!redemptionPort) {
      return reply.code(503).send({ error: "SUPABASE_GIFT_CODE_REDEMPTION_UNAVAILABLE" });
    }

    try {
      const allowed = await redemptionPort.consumeRateLimit({ telegramUserId: user.telegramId, limit: 5 });
      if (!allowed) return reply.code(429).send({ error: "GIFT_CODE_RATE_LIMITED", retryAfterSeconds: 60 });

      const code = body.data.code.toUpperCase();
      const rewardType = await redemptionPort.getRewardType(code);
      if (rewardType === "GROUP_POINTS") {
        if (!body.data.telegramGroupId) throw new Error("GIFT_CODE_GROUP_REQUIRED");
        await verifyTelegramGroupActor({
          telegramGroupId: body.data.telegramGroupId,
          telegramUserId: user.telegramId,
        });
      }
      return await redemptionPort.redeem({
        userId: user.id,
        code,
        idempotencyKey: body.data.idempotencyKey,
        telegramGroupId: body.data.telegramGroupId ?? null,
      });
    } catch (error) {
      if (error instanceof TelegramGroupAuthorizationError) {
        const status = error.code === "TELEGRAM_BOT_TOKEN_NOT_CONFIGURED" ? 503
          : error.code === "TELEGRAM_GROUP_CHECK_FAILED" ? 502 : 403;
        return reply.code(status).send({ error: error.code });
      }
      if (error instanceof Error && error.message.startsWith("GIFT_CODE_")) {
        const status = error.message === "GIFT_CODE_GROUP_REQUIRED" ? 400 : 409;
        return reply.code(status).send({ error: error.message });
      }
      if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") {
        return reply.code(409).send({ error: error.message });
      }
      req.log.error({ error }, "Gift code redemption failed through Supabase");
      return reply.code(503).send({ error: "GIFT_CODE_REDEMPTION_UNAVAILABLE" });
    }
  });
}
