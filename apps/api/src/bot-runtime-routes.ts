import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { BotRuntimeLeasePort } from "./bot-runtime-lease-context.js";

function authenticate(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.BOT_API_SECRET;
  const received = request.headers["x-football-bot-secret"];
  if (!expected) { reply.code(503).send({ error: "BOT_AUTH_NOT_CONFIGURED" }); return false; }
  const a = Buffer.from(typeof received === "string" ? received : "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { reply.code(401).send({ error: "UNAUTHENTICATED_BOT_REQUEST" }); return false; }
  return true;
}

export function registerBotRuntimeRoutes(app: FastifyInstance, dependencies: { leasePort?: BotRuntimeLeasePort; requireLeasePort?: boolean } = {}) {
  app.post("/v1/bot/runtime/lease", async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const parsed = z.object({
      instanceId: z.string().uuid(),
      action: z.enum(["acquire", "heartbeat", "release"]),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_BOT_RUNTIME_LEASE" });

    const { instanceId, action } = parsed.data;
    const now = new Date().toISOString();
    if (dependencies.leasePort) {
      const result = await dependencies.leasePort.execute(instanceId, action, now);
      return action === "release"
        ? { released: result.released }
        : { acquired: result.acquired, leaseExpiresAt: result.leaseExpiresAt };
    }
    return reply.code(503).send({ error: "SUPABASE_BOT_RUNTIME_LEASE_UNAVAILABLE" });
  });

  app.post("/v1/bot/verify-identity", async (request, reply) => {
    if (!authenticate(request, reply)) return;
    const body = z.object({ telegramBotId: z.number().int().positive() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BOT_IDENTITY" });
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return reply.code(503).send({ error: "TELEGRAM_BOT_NOT_CONFIGURED" });
    try {
      const response = await fetch("https://api.telegram.org/bot" + token + "/getMe", { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return reply.code(503).send({ error: "TELEGRAM_BOT_IDENTITY_CHECK_FAILED" });
      const payload = await response.json() as { ok?: boolean; result?: { id?: number; username?: string } };
      if (!payload.ok || !payload.result?.id) return reply.code(503).send({ error: "TELEGRAM_BOT_IDENTITY_CHECK_FAILED" });
      if (payload.result.id !== body.data.telegramBotId) return reply.code(409).send({ error: "BOT_API_TOKEN_MISMATCH" });
      return { verified: true, username: payload.result.username ?? null };
    } catch (error) {
      request.log.error({ error }, "Telegram Bot identity verification failed");
      return reply.code(503).send({ error: "TELEGRAM_BOT_IDENTITY_CHECK_FAILED" });
    }
  });
}
