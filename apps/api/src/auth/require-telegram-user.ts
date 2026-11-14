import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { verifyTelegramInitData } from "./telegram-init-data.js";

function safeSecretMatch(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function requireTelegramUser(request: FastifyRequest) {
  const botSecret = process.env.BOT_API_SECRET;
  const receivedBotSecret = request.headers["x-football-bot-secret"];
  const telegramUserId = request.headers["x-telegram-user-id"];
  if (botSecret && typeof receivedBotSecret === "string" && safeSecretMatch(receivedBotSecret, botSecret)
    && typeof telegramUserId === "string" && /^\d{1,20}$/.test(telegramUserId)) {
    return prisma.user.findUnique({
      where: { telegramId: telegramUserId },
      select: { id: true, telegramId: true, username: true, displayName: true, createdAt: true, isSuspended: true },
    }).then((account) => account?.isSuspended ? null : account);
  }

  const rawInitData = request.headers["x-telegram-init-data"];
  const initData = typeof rawInitData === "string" ? rawInitData : undefined;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!initData || !botToken) return null;
  try {
    const verified = verifyTelegramInitData(initData, botToken);
    return await prisma.user.findUnique({
      where: { telegramId: String(verified.user.id) },
      select: { id: true, telegramId: true, username: true, displayName: true, createdAt: true, isSuspended: true },
    }).then((account) => account?.isSuspended ? null : account);
  } catch {
    return null;
  }
}
