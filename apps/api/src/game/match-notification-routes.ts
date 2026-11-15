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
    const parsed = z.object({ limit: z.number().int().min(1).max(100).default(25) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_MATCH_NOTIFICATION_CLAIM" });
    const now = new Date();
    const notifications = await prisma.$transaction(async (tx) => {
      const checkpoints = await tx.matchTacticalCheckpoint.findMany({
        where: {
          status: "OPEN",
          decisionDeadlineAt: { gt: now },
          OR: [{ homeBotNotifiedAt: null }, { awayBotNotifiedAt: null }],
        },
        include: {
          match: {
            select: {
              id: true,
              homeClub: { select: { id: true, name: true, owner: { select: { telegramId: true } } } },
              awayClub: { select: { id: true, name: true, owner: { select: { telegramId: true } } } },
            },
          },
        },
        orderBy: [{ openedAt: "asc" }, { minute: "asc" }],
        take: parsed.data.limit,
      });
      const claimed: Array<{ checkpointId:string; matchId:string; checkpointKey:string; minute:number; deadlineAt:string; clubId:string; clubName:string; opponentName:string; telegramUserId:string; side:"HOME"|"AWAY" }> = [];
      for (const checkpoint of checkpoints) {
        const match = checkpoint.match;
        if (!checkpoint.homeBotNotifiedAt) {
          const result = await tx.matchTacticalCheckpoint.updateMany({
            where: { id: checkpoint.id, status: "OPEN", homeBotNotifiedAt: null },
            data: { homeBotNotifiedAt: now },
          });
          if (result.count === 1) claimed.push({
            checkpointId: checkpoint.id, matchId: match.id, checkpointKey: checkpoint.checkpointKey,
            minute: checkpoint.minute, deadlineAt: checkpoint.decisionDeadlineAt.toISOString(),
            clubId: match.homeClub.id, clubName: match.homeClub.name, opponentName: match.awayClub.name,
            telegramUserId: match.homeClub.owner.telegramId, side: "HOME",
          });
        }
        if (!checkpoint.awayBotNotifiedAt) {
          const result = await tx.matchTacticalCheckpoint.updateMany({
            where: { id: checkpoint.id, status: "OPEN", awayBotNotifiedAt: null },
            data: { awayBotNotifiedAt: now },
          });
          if (result.count === 1) claimed.push({
            checkpointId: checkpoint.id, matchId: match.id, checkpointKey: checkpoint.checkpointKey,
            minute: checkpoint.minute, deadlineAt: checkpoint.decisionDeadlineAt.toISOString(),
            clubId: match.awayClub.id, clubName: match.awayClub.name, opponentName: match.homeClub.name,
            telegramUserId: match.awayClub.owner.telegramId, side: "AWAY",
          });
        }
      }
      return claimed;
    });
    return { notifications };
  });
}
