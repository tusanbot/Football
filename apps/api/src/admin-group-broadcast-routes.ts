import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";

function authenticate(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.BOT_API_SECRET;
  const received = request.headers["x-football-bot-secret"];
  if (!expected) { reply.code(503).send({ error: "BOT_AUTH_NOT_CONFIGURED" }); return false; }
  const a = Buffer.from(typeof received === "string" ? received : "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { reply.code(401).send({ error: "UNAUTHENTICATED_BOT_REQUEST" }); return false; }
  return true;
}

export function registerAdminGroupBroadcastRoutes(app: FastifyInstance) {
  app.post("/v1/bot/admin-group-broadcasts/claim", async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const parsed = z.object({ limit: z.number().int().min(1).max(100).default(20) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BROADCAST_CLAIM" });
    const deliveries = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "AdminGroupBroadcastDelivery" d
        SET "deliveredAt" = NOW(), "deliveryLastError" = 'SKIPPED_GROUP_INACTIVE',
            "deliveryClaimToken" = NULL, "deliveryLockedUntil" = NULL
        WHERE d."deliveredAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM "TelegramGroup" g
            WHERE g."telegramId" = d."telegramGroupId"
              AND (g."isActive" = false OR g."isSuspended" = true)
          )
      `;
      const due = await tx.$queryRaw<Array<{id:string;telegramGroupId:string;message:string}>>`
        SELECT d."id", d."telegramGroupId", b."message"
        FROM "AdminGroupBroadcastDelivery" d
        INNER JOIN "AdminGroupBroadcast" b ON b."id" = d."broadcastId"
        INNER JOIN "TelegramGroup" g ON g."telegramId" = d."telegramGroupId"
        WHERE g."isActive" = true AND g."isSuspended" = false
          AND d."deliveredAt" IS NULL
          AND d."deliveryAttempts" < 8
          AND d."availableAt" <= NOW()
          AND (d."deliveryLockedUntil" IS NULL OR d."deliveryLockedUntil" <= NOW())
        ORDER BY d."createdAt" ASC
        FOR UPDATE OF d SKIP LOCKED
        LIMIT ${parsed.data.limit}
      `;
      const claimed = [];
      for (const row of due) {
        const claimToken = randomUUID();
        await tx.adminGroupBroadcastDelivery.update({ where: { id: row.id }, data: {
          deliveryClaimToken: claimToken, deliveryLockedUntil: new Date(Date.now() + 60_000),
          deliveryAttempts: { increment: 1 },
        }});
        claimed.push({ ...row, claimToken });
      }
      return claimed;
    });
    return { deliveries };
  });

  app.post("/v1/bot/admin-group-broadcasts/:id/complete", async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const params = z.object({ id: z.string().min(1).max(128) }).safeParse(request.params);
    const body = z.object({ claimToken: z.string().uuid() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_BROADCAST_COMPLETION" });
    const updated = await prisma.adminGroupBroadcastDelivery.updateMany({
      where: { id: params.data.id, deliveryClaimToken: body.data.claimToken, deliveredAt: null },
      data: { deliveredAt: new Date(), deliveryClaimToken: null, deliveryLockedUntil: null, deliveryLastError: null },
    });
    if (updated.count !== 1) return reply.code(409).send({ error: "BROADCAST_CLAIM_NOT_OWNED" });
    return { completed: true };
  });

  app.post("/v1/bot/admin-group-broadcasts/:id/fail", async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const params = z.object({ id: z.string().min(1).max(128) }).safeParse(request.params);
    const body = z.object({ claimToken: z.string().uuid(), error: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_BROADCAST_FAILURE" });
    const row = await prisma.adminGroupBroadcastDelivery.findFirst({
      where: { id: params.data.id, deliveryClaimToken: body.data.claimToken, deliveredAt: null },
      select: { deliveryAttempts: true },
    });
    if (!row) return reply.code(409).send({ error: "BROADCAST_CLAIM_NOT_OWNED" });
    const delay = Math.min(15_000 * 2 ** Math.max(0, row.deliveryAttempts - 1), 3_600_000);
    const updated = await prisma.adminGroupBroadcastDelivery.updateMany({
      where: { id: params.data.id, deliveryClaimToken: body.data.claimToken, deliveredAt: null },
      data: {
        deliveryClaimToken: null,
        deliveryLockedUntil: null,
        availableAt: row.deliveryAttempts >= 8 ? new Date("9999-12-31T00:00:00.000Z") : new Date(Date.now() + delay),
        deliveryLastError: body.data.error,
      },
    });
    if (updated.count !== 1) return reply.code(409).send({ error: "BROADCAST_CLAIM_NOT_OWNED" });
    return { rescheduled: row.deliveryAttempts < 8, attempts: row.deliveryAttempts };
  });
}
