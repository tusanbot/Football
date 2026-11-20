import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export interface TelegramMessageDeletionJob {
  id: string;
  telegramChatId: string;
  messageId: number;
  claimToken: string;
}
export interface TelegramMessageDeletionPort {
  schedule(input: { telegramChatId: string; messageId: number; deleteAt: string }): Promise<{ id: string; status: string; deleteAt: string }>;
  claim(limit: number): Promise<TelegramMessageDeletionJob[]>;
  complete(id: string, claimToken: string): Promise<boolean>;
  fail(id: string, claimToken: string, error: string): Promise<{ rescheduled: boolean; failed: boolean; attempts: number } | null>;
}

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
const jobParams = z.object({ id: z.string().min(1).max(64) });
const claimBody = z.object({ limit: z.number().int().min(1).max(100).default(25) });
const claimTokenBody = z.object({ claimToken: z.string().uuid() });

export function registerTelegramMessageDeletionRoutes(app: FastifyInstance, repository?: TelegramMessageDeletionPort) {
  const getRepository = () => {
    if (!repository && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
      throw new Error("TELEGRAM_MESSAGE_DELETION_SUPABASE_REPOSITORY_REQUIRED");
    }
    return repository;
  };
  app.post("/v1/bot/group-message-deletions", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = z.object({
      telegramChatId: z.string().regex(/^-?\d{1,20}$/),
      messageId: z.number().int().positive(),
      deleteAt: z.string().datetime(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_GROUP_MESSAGE_DELETION" });
    const repo = getRepository();
    if (!repo) return reply.code(503).send({ error: "TELEGRAM_MESSAGE_DELETION_REPOSITORY_REQUIRED" });
    const job = await repo.schedule(parsed.data);
    return reply.code(202).send({ job });
  });
  app.post("/v1/bot/group-message-deletions/claim", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const parsed = claimBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_DELETION_CLAIM" });
    const repo = getRepository();
    if (!repo) return reply.code(503).send({ error: "TELEGRAM_MESSAGE_DELETION_REPOSITORY_REQUIRED" });
    return { jobs: await repo.claim(parsed.data.limit) };
  });
  app.post("/v1/bot/group-message-deletions/:id/complete", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const params = jobParams.safeParse(request.params);
    const body = claimTokenBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_DELETION_COMPLETION" });
    const repo = getRepository();
    if (!repo) return reply.code(503).send({ error: "TELEGRAM_MESSAGE_DELETION_REPOSITORY_REQUIRED" });
    if (!await repo.complete(params.data.id, body.data.claimToken)) return reply.code(409).send({ error: "DELETION_CLAIM_NOT_OWNED" });
    return { completed: true };
  });
  app.post("/v1/bot/group-message-deletions/:id/fail", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const params = jobParams.safeParse(request.params);
    const body = claimTokenBody.extend({ error: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_DELETION_FAILURE" });
    const repo = getRepository();
    if (!repo) return reply.code(503).send({ error: "TELEGRAM_MESSAGE_DELETION_REPOSITORY_REQUIRED" });
    const result = await repo.fail(params.data.id, body.data.claimToken, body.data.error);
    if (!result) return reply.code(409).send({ error: "DELETION_CLAIM_NOT_OWNED" });
    return result;
  });
}
