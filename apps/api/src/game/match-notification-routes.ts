import { randomUUID, timingSafeEqual } from "node:crypto";
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

  app.post("/v1/bot/match-results/claim", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = z.object({ limit: z.number().int().min(1).max(100).default(25) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_MATCH_RESULT_CLAIM" });
    const now = new Date();
    const retryBefore = new Date(now.getTime() - 30_000);
    const candidates = await prisma.matchResultNotification.findMany({
      where: {
        status: "PENDING", availableAt: { lte: now },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: retryBefore } }],
        match: { status: "COMPLETED" },
      },
      include: { match: { select: {
        id: true, homeScore: true, awayScore: true, completedAt: true,
        homeClub: { select: { name: true } }, awayClub: { select: { name: true } },
      } } },
      orderBy: { createdAt: "asc" }, take: parsed.data.limit,
    });
    const notifications = [];
    for (const item of candidates) {
      const claimToken = randomUUID();
      const claimed = await prisma.matchResultNotification.updateMany({
        where: {
          id: item.id, status: "PENDING", availableAt: { lte: now },
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: retryBefore } }],
        },
        data: { claimToken, lockedUntil: new Date(now.getTime() + 30_000), attempts: { increment: 1 } },
      });
      if (claimed.count === 1) notifications.push({
        id: item.id, channel: item.channel, telegramChatId: item.telegramChatId, claimToken,
        attempt: item.attempts + 1,
        match: {
          id: item.match.id, homeClub: item.match.homeClub.name, awayClub: item.match.awayClub.name,
          homeScore: item.match.homeScore, awayScore: item.match.awayScore,
          completedAt: item.match.completedAt?.toISOString() ?? null,
        },
      });
    }
    return { notifications };
  });

  app.post("/v1/bot/match-results/ack", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = z.object({
      id: z.string().min(1).max(64), claimToken: z.string().uuid(),
      delivered: z.boolean(), error: z.string().max(500).optional(),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_MATCH_RESULT_ACK" });
    const now = new Date();
    const result = await prisma.matchResultNotification.updateMany({
      where: { id: parsed.data.id, status: "PENDING", claimToken: parsed.data.claimToken, lockedUntil: { gt: now } },
      data: parsed.data.delivered
        ? { status: "DELIVERED", deliveredAt: now, lockedUntil: null, claimToken: null, lastError: null }
        : { availableAt: new Date(now.getTime() + 30_000), lockedUntil: null, claimToken: null, lastError: parsed.data.error ?? "TELEGRAM_SEND_FAILED" },
    });
    if (result.count !== 1) return reply.code(409).send({ error: "MATCH_RESULT_CLAIM_EXPIRED" });
    return { acknowledged: true, delivered: parsed.data.delivered };
  });

  app.post("/v1/bot/match-lifecycle/claim", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = z.object({ limit: z.number().int().min(1).max(100).default(50) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_MATCH_LIFECYCLE_CLAIM" });
    const now = new Date();
    const retryBefore = new Date(now.getTime() - 30_000);
    const candidates = await prisma.matchLifecycleNotification.findMany({
      where: { status: "PENDING", availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: retryBefore } }], match: { status: { in: ["IN_PROGRESS", "COMPLETED"] } } },
      include: { match: { select: { id: true, homeClub: { select: { name: true } }, awayClub: { select: { name: true } } } } },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }], take: parsed.data.limit,
    });
    const notifications = [];
    for (const item of candidates) {
      const claimToken = randomUUID();
      const claimed = await prisma.matchLifecycleNotification.updateMany({
        where: { id: item.id, status: "PENDING", availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: retryBefore } }] },
        data: { claimToken, lockedUntil: new Date(now.getTime() + 30_000), attempts: { increment: 1 } },
      });
      if (claimed.count === 1) notifications.push({
        id: item.id, channel: item.channel, telegramChatId: item.telegramChatId, claimToken, attempt: item.attempts + 1,
        kind: item.kind, minute: item.minute, homeScore: item.homeScore, awayScore: item.awayScore, payload: item.payload,
        match: { id: item.match.id, homeClub: item.match.homeClub.name, awayClub: item.match.awayClub.name },
      });
    }
    return { notifications };
  });

  app.post("/v1/bot/match-lifecycle/ack", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = z.object({ id: z.string().min(1).max(64), claimToken: z.string().uuid(), delivered: z.boolean(), error: z.string().max(500).optional() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_MATCH_LIFECYCLE_ACK" });
    const now = new Date();
    const result = await prisma.matchLifecycleNotification.updateMany({
      where: { id: parsed.data.id, status: "PENDING", claimToken: parsed.data.claimToken, lockedUntil: { gt: now } },
      data: parsed.data.delivered
        ? { status: "DELIVERED", deliveredAt: now, lockedUntil: null, claimToken: null, lastError: null }
        : { availableAt: new Date(now.getTime() + 15_000), lockedUntil: null, claimToken: null, lastError: parsed.data.error ?? "TELEGRAM_SEND_FAILED" },
    });
    if (result.count !== 1) return reply.code(409).send({ error: "MATCH_LIFECYCLE_CLAIM_EXPIRED" });
    return { acknowledged: true, delivered: parsed.data.delivered };
  });
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
          openedAt: { lte: now },
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
