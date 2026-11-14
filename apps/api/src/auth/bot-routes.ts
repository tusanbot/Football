import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { provisionTelegramAccount } from "./account-provisioning-service.js";

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(128),
  lastName: z.string().trim().max(128).optional(),
  username: z.string().trim().min(1).max(64).optional(),
});

function matchesSecret(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bot-only onboarding. The Telegram ID is accepted only over the authenticated
 * server-to-server channel; never expose BOT_API_SECRET to the Mini App. */
export function registerBotAuthRoutes(app: FastifyInstance) {
  app.post("/v1/auth/bot", async (request, reply) => {
    const expectedSecret = process.env.BOT_API_SECRET;
    const receivedSecret = request.headers["x-football-bot-secret"];
    const rawTelegramId = request.headers["x-telegram-user-id"];

    if (!expectedSecret) return reply.code(503).send({ error: "BOT_AUTH_NOT_CONFIGURED" });
    if (typeof receivedSecret !== "string" || !matchesSecret(receivedSecret, expectedSecret)
      || typeof rawTelegramId !== "string" || !/^\d{1,20}$/.test(rawTelegramId)) {
      return reply.code(401).send({ error: "UNAUTHENTICATED_BOT_REQUEST" });
    }

    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST", details: parsed.error.flatten() });

    const displayName = [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(" ");
    try {
      const user = await provisionTelegramAccount({
        telegramId: rawTelegramId,
        username: parsed.data.username ?? null,
        displayName,
        firstName: parsed.data.firstName,
      });
      return reply.code(200).send({
        user: { id: user.id, telegramId: user.telegramId, displayName: user.displayName },
        club: user.club,
        wallets: user.wallets.map((wallet) => ({ asset: wallet.asset, balance: wallet.balance.toString() })),
      });
    } catch (error) {
      request.log.error({ error }, "Bot account provisioning failed");
      return reply.code(500).send({ error: "ACCOUNT_PROVISIONING_FAILED" });
    }
  });
}
