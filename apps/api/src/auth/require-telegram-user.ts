import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { verifyTelegramInitData } from "./telegram-init-data.js";
import { verifyTelegramSessionToken } from "./telegram-session.js";
import { getTelegramUserLookupPort } from "./telegram-user-lookup-context.js";

function safeSecretMatch(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loadActiveUser(telegramId: string) {
  const lookupPort = getTelegramUserLookupPort();
  if (lookupPort) return lookupPort.loadActiveUser(telegramId);
  const account = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, telegramId: true, username: true, displayName: true, createdAt: true, isSuspended: true },
  });
  if (!account || account.isSuspended) return null;
  const now = new Date();
  // Throttle writes to one activity touch per account per minute.
  await prisma.user.updateMany({
    where: { id: account.id, lastActiveAt: { lt: new Date(now.getTime() - 60_000) } },
    data: { lastActiveAt: now },
  });
  return account;
}

export async function requireTelegramUser(request: FastifyRequest) {
  const botSecret = process.env.BOT_API_SECRET;
  const receivedBotSecret = request.headers["x-football-bot-secret"];
  const telegramUserId = request.headers["x-telegram-user-id"];
  if (botSecret && typeof receivedBotSecret === "string" && safeSecretMatch(receivedBotSecret, botSecret)
    && typeof telegramUserId === "string" && /^\\d{1,20}$/.test(telegramUserId)) {
    return loadActiveUser(telegramUserId);
  }

  const authorization = request.headers.authorization;
  if (botSecret && typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    const claims = verifyTelegramSessionToken(authorization.slice(7), botSecret);
    if (claims) return loadActiveUser(claims.telegramId);
  }

  const rawInitData = request.headers["x-telegram-init-data"];
  const initData = typeof rawInitData === "string" ? rawInitData : undefined;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!initData || !botToken) return null;
  try {
    const verified = verifyTelegramInitData(initData, botToken);
    return await loadActiveUser(String(verified.user.id));
  } catch {
    return null;
  }
}
