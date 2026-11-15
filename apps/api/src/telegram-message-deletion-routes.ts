import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";

function authenticateSystemBot(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.BOT_API_SECRET;
  const received = request.headers["x-football-bot-secret"];
  if (!expected) {
    reply.code(503).send({ error: "BOT_AUTH_NOT_CONFIGURED" });
    return false;
  }
  const a = Buffer.from(typeof received === "string" ? received : "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: "UNAUTHENTICATED_BOT_REQUEST" });
    return false;
  }
  return true;
}

const jobParams = z.object({ id: z.string().min(1).max(64) });
const claimBody = z.object({ limit: z.number().int().min(1).max(100).default(25) });
const claimTokenBody = z.object({ claimToken: z.string().uuid() });

export function registerTelegramMessageDeletionRoutes(app: FastifyInstance) {
  app.post("/v1/bot/group-message-deletions", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = z.object({
      telegramChatId: z.string().regex(/^-?\d{1,20}$/),
      messageId: z.number().int().positive(),
      deleteAt: z.string().datetime(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_GROUP_MESSAGE_DELETION" });

    const telegramChatId = BigInt(parsed.data.telegramChatId);
    const deleteAt = new Date(parsed.data.deleteAt);
    const job = await prisma.telegramMessageDeletion.upsert({
      where: { telegramChatId_messageId: { telegramChatId, messageId: parsed.data.messageId } },
      create: { telegramChatId, messageId: parsed.data.messageId, deleteAt, availableAt: deleteAt },
      update: {
        deleteAt, availableAt: deleteAt, status: "PENDING", attempts: 0,
        lockedUntil: null, claimToken: null, lastError: null, deletedAt: null,
      },
      select: { id: true, status: true, deleteAt: true },
    });
    return reply.code(202).send({ job: { ...job, deleteAt: job.deleteAt.toISOString() } });
  });

  app.post("/v1/bot/group-message-deletions/claim", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = claimBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_DELETION_CLAIM" });

    const jobs = await prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<Array<{ id: string; telegramChatId: bigint; messageId: number }>>`
        SELECT "id", "telegramChatId", "messageId"
        FROM "TelegramMessageDeletion"
        WHERE
          ("status" = 'PENDING' AND "deleteAt" <= NOW() AND "availableAt" <= NOW())
          OR ("status" = 'PROCESSING' AND "lockedUntil" <= NOW())
        ORDER BY "deleteAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${parsed.data.limit}
      `;
      const now = Date.now();
      const claimed = [];
      for (const row of due) {
        const claimToken = randomUUID();
        await tx.telegramMessageDeletion.update({
          where: { id: row.id },
          data: {
            status: "PROCESSING",
            attempts: { increment: 1 },
            lockedUntil: new Date(now + 60_000),
            claimToken,
          },
        });
        claimed.push({
          id: row.id,
          telegramChatId: row.telegramChatId.toString(),
          messageId: row.messageId,
          claimToken,
        });
      }
      return claimed;
    });
    return { jobs };
  });

  app.post("/v1/bot/group-message-deletions/:id/complete", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const params = jobParams.safeParse(request.params);
    const body = claimTokenBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_DELETION_COMPLETION" });
    const result = await prisma.telegramMessageDeletion.updateMany({
      where: { id: params.data.id, status: "PROCESSING", claimToken: body.data.claimToken },
      data: { status: "DELETED", deletedAt: new Date(), lockedUntil: null, claimToken: null, lastError: null },
    });
    if (result.count !== 1) return reply.code(409).send({ error: "DELETION_CLAIM_NOT_OWNED" });
    return { completed: true };
  });

  app.post("/v1/bot/group-message-deletions/:id/fail", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const params = jobParams.safeParse(request.params);
    const body = claimTokenBody.extend({ error: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_DELETION_FAILURE" });

    const job = await prisma.telegramMessageDeletion.findFirst({
      where: { id: params.data.id, status: "PROCESSING", claimToken: body.data.claimToken },
      select: { attempts: true },
    });
    if (!job) return reply.code(409).send({ error: "DELETION_CLAIM_NOT_OWNED" });
    const exhausted = job.attempts >= 8;
    const retryDelayMs = Math.min(15_000 * 2 ** Math.max(0, job.attempts - 1), 60 * 60 * 1000);
    const result = await prisma.telegramMessageDeletion.updateMany({
      where: { id: params.data.id, status: "PROCESSING", claimToken: body.data.claimToken },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        availableAt: new Date(Date.now() + retryDelayMs),
        lockedUntil: null,
        claimToken: null,
        lastError: body.data.error,
      },
    });
    if (result.count !== 1) return reply.code(409).send({ error: "DELETION_CLAIM_NOT_OWNED" });
    return { rescheduled: !exhausted, failed: exhausted, attempts: job.attempts };
  });
}
