import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

function authenticateSystemBot(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.BOT_API_SECRET;
  const received = request.headers["x-football-bot-secret"];
  if (!expected) { reply.code(503).send({ error: "BOT_AUTH_NOT_CONFIGURED" }); return false; }
  const a = Buffer.from(typeof received === "string" ? received : "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: "UNAUTHENTICATED_BOT_REQUEST" }); return false;
  }
  return true;
}

export function registerMatchNotificationRoutes(app: FastifyInstance) {
  app.post("/v1/bot/match-checkpoints/claim", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = z.object({ limit: z.number().int().min(1).max(100).default(25), checkpointId: z.string().min(1).max(64).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_MATCH_NOTIFICATION_CLAIM" });
    const now = new Date();
    const retryBefore = new Date(now.getTime() - 30_000);
    const notifications = await prisma.$transaction(async (tx) => {
      const checkpoints = await tx.matchTacticalCheckpoint.findMany({
        where: {
          ...(parsed.data.checkpointId ? { id: parsed.data.checkpointId } : {}),
          status: "OPEN",
          decisionDeadlineAt: { gt: now },
          OR: [
            { homeBotNotifiedAt: null, OR: [
              { homeBotNotificationClaimedAt: null },
              { homeBotNotificationClaimedAt: { lt: retryBefore } },
            ] },
            { awayBotNotifiedAt: null, OR: [
              { awayBotNotificationClaimedAt: null },
              { awayBotNotificationClaimedAt: { lt: retryBefore } },
            ] },
          ],
        },
        include: {
          match: {
            select: {
              id: true,
              homeClub: { select: { id: true, name: true, owner: { select: { telegramId: true } } } },
              awayClub: { select: { id: true, name: true, owner: { select: { telegramId: true } } } },
            },
          },
          decisions: { select: { clubId: true } },
        },
        orderBy: [{ openedAt: "asc" }, { minute: "asc" }],
        take: parsed.data.limit,
      });
      const claimed: Array<{
        checkpointId: string; matchId: string; checkpointKey: string; minute: number;
        deadlineAt: string; clubId: string; clubName: string; opponentName: string;
        telegramUserId: string; side: "HOME" | "AWAY"; attempt: number;
      }> = [];
      for (const checkpoint of checkpoints) {
        const match = checkpoint.match;
        const homeDecided = checkpoint.decisions.some((decision) => decision.clubId === match.homeClub.id);
        if (!checkpoint.homeBotNotifiedAt && homeDecided) {
          await tx.matchTacticalCheckpoint.updateMany({
            where: { id: checkpoint.id, status: "OPEN", homeBotNotifiedAt: null },
            data: { homeBotNotifiedAt: now, homeBotNotificationClaimedAt: null },
          });
        } else if (!checkpoint.homeBotNotifiedAt) {
          const result = await tx.matchTacticalCheckpoint.updateMany({
            where: {
              id: checkpoint.id, status: "OPEN", homeBotNotifiedAt: null,
              OR: [
                { homeBotNotificationClaimedAt: null },
                { homeBotNotificationClaimedAt: { lt: retryBefore } },
              ],
            },
            data: {
              homeBotNotificationClaimedAt: now,
              homeBotNotificationAttempts: { increment: 1 },
            },
          });
          if (result.count === 1) claimed.push({
            checkpointId: checkpoint.id, matchId: match.id, checkpointKey: checkpoint.checkpointKey,
            minute: checkpoint.minute, deadlineAt: checkpoint.decisionDeadlineAt.toISOString(),
            clubId: match.homeClub.id, clubName: match.homeClub.name, opponentName: match.awayClub.name,
            telegramUserId: match.homeClub.owner.telegramId, side: "HOME",
            attempt: checkpoint.homeBotNotificationAttempts + 1,
          });
        }
        const awayDecided = checkpoint.decisions.some((decision) => decision.clubId === match.awayClub.id);
        if (!checkpoint.awayBotNotifiedAt && awayDecided) {
          await tx.matchTacticalCheckpoint.updateMany({
            where: { id: checkpoint.id, status: "OPEN", awayBotNotifiedAt: null },
            data: { awayBotNotifiedAt: now, awayBotNotificationClaimedAt: null },
          });
        } else if (!checkpoint.awayBotNotifiedAt) {
          const result = await tx.matchTacticalCheckpoint.updateMany({
            where: {
              id: checkpoint.id, status: "OPEN", awayBotNotifiedAt: null,
              OR: [
                { awayBotNotificationClaimedAt: null },
                { awayBotNotificationClaimedAt: { lt: retryBefore } },
              ],
            },
            data: {
              awayBotNotificationClaimedAt: now,
              awayBotNotificationAttempts: { increment: 1 },
            },
          });
          if (result.count === 1) claimed.push({
            checkpointId: checkpoint.id, matchId: match.id, checkpointKey: checkpoint.checkpointKey,
            minute: checkpoint.minute, deadlineAt: checkpoint.decisionDeadlineAt.toISOString(),
            clubId: match.awayClub.id, clubName: match.awayClub.name, opponentName: match.homeClub.name,
            telegramUserId: match.awayClub.owner.telegramId, side: "AWAY",
            attempt: checkpoint.awayBotNotificationAttempts + 1,
          });
        }
      }
      return claimed;
    });
    return { notifications };
  });

  app.post("/v1/bot/match-checkpoints/ack", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = z.object({
      checkpointId: z.string().min(1).max(64),
      side: z.enum(["HOME", "AWAY"]),
      delivered: z.boolean(),
      error: z.string().max(500).optional(),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_MATCH_NOTIFICATION_ACK" });
    const { checkpointId, side, delivered, error } = parsed.data;
    const now = new Date();
    const result = side === "HOME"
      ? await prisma.matchTacticalCheckpoint.updateMany({
          where: { id: checkpointId, status: "OPEN", homeBotNotificationClaimedAt: { not: null } },
          data: delivered
            ? { homeBotNotifiedAt: now, homeBotNotificationClaimedAt: null, homeBotNotificationLastError: null }
            : { homeBotNotificationLastError: error ?? "TELEGRAM_SEND_FAILED" },
        })
      : await prisma.matchTacticalCheckpoint.updateMany({
          where: { id: checkpointId, status: "OPEN", awayBotNotificationClaimedAt: { not: null } },
          data: delivered
            ? { awayBotNotifiedAt: now, awayBotNotificationClaimedAt: null, awayBotNotificationLastError: null }
            : { awayBotNotificationLastError: error ?? "TELEGRAM_SEND_FAILED" },
        });
    if (result.count !== 1) return reply.code(409).send({ error: "MATCH_NOTIFICATION_CLAIM_EXPIRED" });
    return { acknowledged: true, delivered };
  });
}
