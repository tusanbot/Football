import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import {
  getClubDevelopment,
  PlayerDevelopmentError,
  renewPlayerContract,
  trainPlayer,
} from "./player-development-service.js";

const playerIdSchema = z.object({ id: z.string().min(1).max(64) });
const trainSchema = z.object({
  focus: z.enum(["BALANCED", "GOALKEEPING", "DEFENDING", "PASSING", "PLAYMAKING", "DRIBBLING", "SHOOTING", "PHYSICAL"]),
  intensity: z.enum(["LIGHT", "NORMAL", "INTENSE"]),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/),
});
const renewSchema = z.object({
  extensionDays: z.union([z.literal(90), z.literal(180), z.literal(365)]),
  weeklyWage: z.string().regex(/^[1-9][0-9]{0,8}$/),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/),
});

function sendDevelopmentError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof PlayerDevelopmentError)) throw error;
  const status = error.code === "CLUB_NOT_FOUND" || error.code === "PLAYER_NOT_FOUND" ? 404
    : error.code === "INSUFFICIENT_CASH" || error.code === "PLAYER_INJURED"
      || error.code === "CONTRACT_EXPIRED" || error.code === "ALREADY_TRAINED_TODAY"
      || error.code === "PLAYER_NOT_AVAILABLE" || error.code === "WAGE_OFFER_TOO_LOW"
      || error.code === "WAGE_OFFER_TOO_HIGH" || error.code === "CONCURRENT_MODIFICATION"
      || error.code === "DAILY_SETTLEMENT_CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT" ? 409
    : 400;
  return reply.code(status).send({ error: error.code, ...(error.details ? { details: error.details } : {}) });
}

export function registerPlayerDevelopmentRoutes(app: FastifyInstance) {
  app.get("/v1/club/development", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try {
      return await getClubDevelopment(user.id);
    } catch (error) {
      return sendDevelopmentError(reply, error);
    }
  });

  app.post("/v1/club/players/:id/train", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = playerIdSchema.safeParse(request.params);
    const body = trainSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "INVALID_TRAINING_REQUEST", details: {
        ...(params.success ? {} : { params: params.error.flatten() }),
        ...(body.success ? {} : { body: body.error.flatten() }),
      } });
    }
    try {
      return { training: await trainPlayer(
        user.id, params.data.id, body.data.focus, body.data.intensity, body.data.idempotencyKey,
      ) };
    } catch (error) {
      return sendDevelopmentError(reply, error);
    }
  });

  app.post("/v1/club/players/:id/contract/renew", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = playerIdSchema.safeParse(request.params);
    const body = renewSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "INVALID_CONTRACT_REQUEST", details: {
        ...(params.success ? {} : { params: params.error.flatten() }),
        ...(body.success ? {} : { body: body.error.flatten() }),
      } });
    }
    try {
      return { contract: await renewPlayerContract(
        user.id, params.data.id, body.data.extensionDays, BigInt(body.data.weeklyWage), body.data.idempotencyKey,
      ) };
    } catch (error) {
      return sendDevelopmentError(reply, error);
    }
  });
}
