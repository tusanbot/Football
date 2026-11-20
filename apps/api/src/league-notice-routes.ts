import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getPyramidLeagueSettlementPort } from "./game/pyramid-league-settlement-context.js";

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
    const port = getPyramidLeagueSettlementPort();
    if (!port) return reply.code(503).send({ error: "SUPABASE_PYRAMID_NOTICE_REPOSITORY_UNAVAILABLE" });
    return port.claimNotices(parsed.data.limit, new Date().toISOString());
  });

  app.post("/v1/bot/league-notices/:id/complete", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const params = paramsSchema.safeParse(request.params);
    const body = tokenSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_LEAGUE_NOTICE_COMPLETION" });
    const port = getPyramidLeagueSettlementPort();
    if (!port) return reply.code(503).send({ error: "SUPABASE_PYRAMID_NOTICE_REPOSITORY_UNAVAILABLE" });
    const result = await port.completeNotice(params.data.id, body.data.claimToken, new Date().toISOString());
    if (!result.completed) return reply.code(409).send({ error: "LEAGUE_NOTICE_CLAIM_NOT_OWNED" });
    return result;
  });

  app.post("/v1/bot/league-notices/:id/fail", async (request, reply) => {
    if (!authenticateSystemBot(request, reply)) return;
    const params = paramsSchema.safeParse(request.params);
    const body = tokenSchema.extend({ error: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_LEAGUE_NOTICE_FAILURE" });
    const port = getPyramidLeagueSettlementPort();
    if (!port) return reply.code(503).send({ error: "SUPABASE_PYRAMID_NOTICE_REPOSITORY_UNAVAILABLE" });
    const result = await port.failNotice(params.data.id, body.data.claimToken, body.data.error, new Date().toISOString());
    if (!result.owned) return reply.code(409).send({ error: "LEAGUE_NOTICE_CLAIM_NOT_OWNED" });
    return { rescheduled: result.rescheduled, attempts: result.attempts };
  });
}
