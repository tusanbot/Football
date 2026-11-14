import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { verifyTelegramInitData } from "./telegram-init-data.js";

const requestSchema = z.object({ initData: z.string().min(1).max(8192) });

export async function registerTelegramAuthRoutes(app: FastifyInstance) {
  app.post("/v1/auth/telegram", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return reply.code(503).send({ error: "TELEGRAM_AUTH_NOT_CONFIGURED" });

    let verified;
    try { verified = verifyTelegramInitData(parsed.data.initData, botToken); }
    catch { return reply.code(401).send({ error: "INVALID_TELEGRAM_INIT_DATA" }); }

    const telegramId = String(verified.user.id);
    const displayName = [verified.user.first_name, verified.user.last_name].filter(Boolean).join(" ");

    try {
      const user = await prisma.user.upsert({
        where: { telegramId },
        update: {
          username: verified.user.username ?? null,
          displayName
        },
        create: {
          telegramId,
          username: verified.user.username ?? null,
          displayName,
          club: { create: { name: `${verified.user.first_name} FC`, slug: `club-${telegramId}` } },
          wallets: { create: [
            { asset: "CASH", balance: 20_000n },
            { asset: "GOLD", balance: 50n }
          ] }
        },
        select: {
          id: true,
          telegramId: true,
          displayName: true,
          club: { select: { id: true, name: true, level: true, reputation: true } },
          wallets: { select: { asset: true, balance: true } }
        }
      });

      return reply.code(200).send({
        user: { id: user.id, telegramId: user.telegramId, displayName: user.displayName },
        club: user.club,
        wallets: user.wallets.map((wallet) => ({ asset: wallet.asset, balance: wallet.balance.toString() }))
      });
    } catch (error) {
      request.log.error({ error }, "Telegram account provisioning failed");
      return reply.code(500).send({ error: "ACCOUNT_PROVISIONING_FAILED" });
    }
  });
}
