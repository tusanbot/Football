import type { FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { verifyTelegramInitData } from "./telegram-init-data.js";

export async function requireTelegramUser(request: FastifyRequest) {
  const rawInitData = request.headers["x-telegram-init-data"];
  const initData = typeof rawInitData === "string" ? rawInitData : undefined;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!initData || !botToken) return null;

  try {
    const verified = verifyTelegramInitData(initData, botToken);
    return await prisma.user.findUnique({
      where: { telegramId: String(verified.user.id) },
      select: {
        id: true,
        telegramId: true,
        username: true,
        displayName: true,
        createdAt: true,
      },
    });
  } catch {
    return null;
  }
}
