import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { MatchTacticalInstruction } from "@football/domain";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import {
  MatchServiceError, createFriendlyMatch, createLeague, getLeague, joinLeague,
  listClubMatches, listMatchOpponents, listOpenLeagues, simulateScheduledMatch, startLeague, submitMatchCheckpointDecision,
} from "./match-service.js";

const keySchema = z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/);
function sendMatchError(reply: FastifyReply, error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2034" || error.code === "P2002")) {
    return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
  }
  if (!(error instanceof MatchServiceError)) throw error;
  const notFound = ["CLUB_NOT_FOUND", "OPPONENT_NOT_FOUND", "COMPETITION_NOT_FOUND", "MATCH_NOT_FOUND"];
  const conflicts = [
    "IDEMPOTENCY_CONFLICT", "CLUB_ALREADY_HAS_MATCH_IN_WINDOW", "COMPETITION_NOT_OPEN",
    "COMPETITION_FULL", "ONLY_CREATOR_CAN_START", "LEAGUE_NEEDS_FOUR_TEAMS",
    "ALL_TEAMS_NEED_VALID_LINEUPS", "NOT_COMPETITION_MEMBER", "NOT_MATCH_PARTICIPANT",
    "MATCH_NOT_SCHEDULED", "MATCH_NOT_DUE", "MATCH_ALREADY_SIMULATED", "CONCURRENT_MODIFICATION",
    "MATCH_CHECKPOINT_CLOSED", "MATCH_CHECKPOINT_NOT_FOUND",
  ];
  const status = notFound.includes(error.code) ? 404 : conflicts.includes(error.code) ? 409 : 400;
  return reply.code(status).send({ error: error.code, ...(error.details ? { details: error.details } : {}) });
}
export function registerMatchRoutes(app: FastifyInstance) {
  app.get("/v1/matches/opponents", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try { return { opponents: await listMatchOpponents(user.id) }; }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.get("/v1/matches", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try { return await listClubMatches(user.id); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.post("/v1/matches/friendly", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = z.object({
      opponentClubId: z.string().min(1).max(64), idempotencyKey: keySchema,
      scheduledAt: z.string().datetime().optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_FRIENDLY_MATCH" });
    try {
      const result = await createFriendlyMatch(user.id, body.data.opponentClubId, body.data.idempotencyKey,
        body.data.scheduledAt ? new Date(body.data.scheduledAt) : undefined);
      return { match: result.match, replayed: result.replayed };
    } catch (error) { return sendMatchError(reply, error); }
  });
  app.post("/v1/matches/:id/simulate", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_MATCH_ID" });
    try { return { result: await simulateScheduledMatch(user.id, params.data.id) }; }
    catch (error) { return sendMatchError(reply, error); }
  });

  app.post("/v1/matches/:id/checkpoints/:checkpointKey/decisions", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().min(1).max(64), checkpointKey: z.string().trim().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_MATCH_CHECKPOINT" });
    const body = z.object({
      idempotencyKey: keySchema,
      instruction: z.object({
        formation: z.string().regex(/^[0-9](?:-[0-9]){2,4}$/).optional(),
        mentality: z.enum(["DEFENSIVE", "BALANCED", "ATTACKING"]).optional(),
        pressing: z.enum(["LOW_BLOCK", "MID_BLOCK", "HIGH_PRESS"]).optional(),
        tempo: z.enum(["SLOW", "NORMAL", "FAST"]).optional(),
        passingStyle: z.enum(["SHORT", "MIXED", "DIRECT"]).optional(),
        substitutions: z.array(z.object({
          outgoingPlayerId: z.string().min(1).max(64), incomingPlayerId: z.string().min(1).max(64),
        }).strict()).max(5).optional(),
      }).strict().refine((value) => Object.keys(value).length > 0, "At least one tactical change is required"),
    }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_MATCH_DECISION" });
    try {
      const instruction = Object.fromEntries(
        Object.entries(body.data.instruction).filter(([, value]) => value !== undefined),
      ) as MatchTacticalInstruction;
      return await submitMatchCheckpointDecision(user.id, params.data.id, params.data.checkpointKey,
        body.data.idempotencyKey, instruction);
    } catch (error) { return sendMatchError(reply, error); }
  });

  app.get("/v1/competitions", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try { return { competitions: await listOpenLeagues(user.id) }; }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.post("/v1/competitions", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = z.object({
      name: z.string().trim().min(3).max(40), maxTeams: z.number().int().min(4).max(10),
      format: z.enum(["LEAGUE", "CUP"]).default("LEAGUE"), idempotencyKey: keySchema,
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_COMPETITION" });
    try { return await createLeague(user.id, body.data.name, body.data.maxTeams, body.data.idempotencyKey, body.data.format); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.post("/v1/competitions/:id/join", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_COMPETITION_ID" });
    try { return await joinLeague(user.id, params.data.id); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.post("/v1/competitions/:id/start", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_COMPETITION_ID" });
    try { return await startLeague(user.id, params.data.id); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.get("/v1/competitions/:id", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_COMPETITION_ID" });
    try { return await getLeague(user.id, params.data.id); }
    catch (error) { return sendMatchError(reply, error); }
  });
}
