import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";

function authenticateSystemBot(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.BOT_API_SECRET;
  const received = request.headers["x-football-bot-secret"];
  if (!expected) { reply.code(503).send({ error: "BOT_AUTH_NOT_CONFIGURED" }); return false; }
  const a = Buffer.from(typeof received === "string" ? received : "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { reply.code(401).send({ error: "UNAUTHENTICATED_BOT_REQUEST" }); return false; }
  return true;
}
const claimSchema = z.object({ limit: z.number().int().min(1).max(100).default(25) });
const paramsSchema = z.object({ id: z.string().min(1).max(64) });
const tokenSchema = z.object({ claimToken: z.string().uuid() });

export function registerLeagueNoticeRoutes(app: FastifyInstance) {
  app.post("/v1/bot/league-notices/claim", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = claimSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_LEAGUE_NOTICE_CLAIM" });
    const notices = await prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<Array<{ id: string; userId: string; telegramId: string; title: string; body: string }>>`
        SELECT n."id", n."userId", u."telegramId", n."title", n."body"
        FROM "LeagueNotice" n
        INNER JOIN "User" u ON u."id" = n."userId"
        WHERE n."deliveredAt" IS NULL
          AND n."deliveryAttempts" < 8
          AND (n."deliveryLockedUntil" IS NULL OR n."deliveryLockedUntil" <= NOW())
        ORDER BY n."createdAt" ASC
        FOR UPDATE OF n SKIP LOCKED
        LIMIT ${parsed.data.limit}
      `;
      const claimed = [];
      for (const notice of due) {
        const claimToken = randomUUID();
        await tx.leagueNotice.update({
          where: { id: notice.id },
          data: { deliveryClaimToken: claimToken, deliveryLockedUntil: new Date(Date.now() + 60_000), deliveryAttempts: { increment: 1 } },
        });
        claimed.push({ id: notice.id, telegramId: notice.telegramId, title: notice.title, body: notice.body, claimToken });
      }
      return claimed;
    });
    return { notices };
  });

  app.post("/v1/bot/league-notices/:id/complete", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const params = paramsSchema.safeParse(request.params);
    const body = tokenSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_LEAGUE_NOTICE_COMPLETION" });
    const result = await prisma.leagueNotice.updateMany({
      where: { id: params.data.id, deliveryClaimToken: body.data.claimToken, deliveredAt: null },
      data: { deliveredAt: new Date(), deliveryClaimToken: null, deliveryLockedUntil: null, deliveryLastError: null },
    });
    if (result.count !== 1) return reply.code(409).send({ error: "LEAGUE_NOTICE_CLAIM_NOT_OWNED" });
    return { completed: true };
  });

  app.post("/v1/bot/league-notices/:id/fail", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const params = paramsSchema.safeParse(request.params);
    const body = tokenSchema.extend({ error: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_LEAGUE_NOTICE_FAILURE" });
    const notice = await prisma.leagueNotice.findFirst({
      where: { id: params.data.id, deliveryClaimToken: body.data.claimToken, deliveredAt: null },
      select: { deliveryAttempts: true },
    });
    if (!notice) return reply.code(409).send({ error: "LEAGUE_NOTICE_CLAIM_NOT_OWNED" });
    const delay = Math.min(15_000 * 2 ** Math.max(0, notice.deliveryAttempts - 1), 60 * 60 * 1000);
    const result = await prisma.leagueNotice.updateMany({
      where: { id: params.data.id, deliveryClaimToken: body.data.claimToken, deliveredAt: null },
      data: { deliveryClaimToken: null, deliveryLockedUntil: notice.deliveryAttempts >= 8 ? new Date("9999-12-31T00:00:00.000Z") : new Date(Date.now() + delay), deliveryLastError: body.data.error },
    });
    if (result.count !== 1) return reply.code(409).send({ error: "LEAGUE_NOTICE_CLAIM_NOT_OWNED" });
    return { rescheduled: notice.deliveryAttempts < 8, attempts: notice.deliveryAttempts };
  });
}
