import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { provisionTelegramAccount } from "./account-provisioning-service.js";
import { verifyTelegramInitData } from "./telegram-init-data.js";

const requestSchema = z.object({ initData: z.string().min(1).max(8192) });

export function registerTelegramAuthRoutes(app: FastifyInstance) {
  app.post("/v1/auth/telegram", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return reply.code(503).send({ error: "TELEGRAM_AUTH_NOT_CONFIGURED" });

    let verified;
    try { verified = verifyTelegramInitData(parsed.data.initData, botToken); }
    catch { return reply.code(401).send({ error: "INVALID_TELEGRAM_INIT_DATA" }); }

    const displayName = [verified.user.first_name, verified.user.last_name].filter(Boolean).join(" ");
    try {
      const user = await provisionTelegramAccount({
        telegramId: String(verified.user.id),
        username: verified.user.username ?? null,
        displayName,
        firstName: verified.user.first_name,
      });
      return reply.code(200).send({
        user: { id: user.id, telegramId: user.telegramId, displayName: user.displayName },
        club: user.club,
        wallets: user.wallets.map((wallet) => ({ asset: wallet.asset, balance: wallet.balance.toString() })),
      });
    } catch (error) {
      request.log.error({ error }, "Telegram account provisioning failed");
      return reply.code(500).send({ error: "ACCOUNT_PROVISIONING_FAILED" });
    }
  });
}
