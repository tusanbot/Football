import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  getTelegramGroupSummary, GroupServiceError, joinTelegramGroup, registerTelegramGroup,
} from "./group-service.js";

function authenticateBot(request: FastifyRequest, reply: FastifyReply): string | null {
  const expected = process.env.BOT_API_SECRET;
  const received = request.headers["x-football-bot-secret"];
  const telegramId = request.headers["x-telegram-user-id"];
  if (!expected) { reply.code(503).send({ error: "BOT_AUTH_NOT_CONFIGURED" }); return null; }
  const a = Buffer.from(typeof received === "string" ? received : "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)
    || typeof telegramId !== "string" || !/^\d{1,20}$/.test(telegramId)) {
    reply.code(401).send({ error: "UNAUTHENTICATED_BOT_REQUEST" });
    return null;
  }
  return telegramId;
}

function sendGroupError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof GroupServiceError)) {
    if (typeof error === "object" && error !== null && "code" in error
      && (error.code === "P2034" || error.code === "P2002")) {
      return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
    }
    throw error;
  }
  const status = error.code === "ACCOUNT_NOT_FOUND" || error.code === "CLUB_NOT_FOUND"
    || error.code === "GROUP_NOT_REGISTERED" ? 404
    : error.code === "NOT_GROUP_MEMBER" ? 403 : 400;
  return reply.code(status).send({ error: error.code });
}

const groupId = z.string().regex(/^-?\d{1,20}$/);
export function registerGroupRoutes(app: FastifyInstance) {
  app.post("/v1/groups/register", async (request, reply) => {
    const telegramUserId = authenticateBot(request, reply);
    if (!telegramUserId) return;
    const parsed = z.object({
      telegramGroupId: groupId,
      title: z.string().trim().min(1).max(255),
      role: z.enum(["OWNER", "ADMIN"]),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_GROUP_REGISTRATION" });
    try {
      return { registration: await registerTelegramGroup({ telegramUserId, ...parsed.data }) };
    } catch (error) { return sendGroupError(reply, error); }
  });

  app.post("/v1/groups/join", async (request, reply) => {
    const telegramUserId = authenticateBot(request, reply);
    if (!telegramUserId) return;
    const parsed = z.object({ telegramGroupId: groupId }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_GROUP_JOIN" });
    try {
      return { membership: await joinTelegramGroup({ telegramUserId, ...parsed.data }) };
    } catch (error) { return sendGroupError(reply, error); }
  });

  app.get("/v1/groups/:telegramGroupId", async (request, reply) => {
    const telegramUserId = authenticateBot(request, reply);
    if (!telegramUserId) return;
    const parsed = z.object({ telegramGroupId: groupId }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_GROUP_ID" });
    try {
      return await getTelegramGroupSummary(telegramUserId, parsed.data.telegramGroupId);
    } catch (error) { return sendGroupError(reply, error); }
  });
}
