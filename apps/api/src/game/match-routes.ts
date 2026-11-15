import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { MatchTacticalInstruction } from "@football/domain";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import { TelegramGroupAuthorizationError, verifyTelegramGroupActor } from "../groups/telegram-group-authorization.js";
import { getMatchFallbackPlan, saveMatchFallbackPlan, MatchFallbackPlanError } from "./match-fallback-service.js";
import {
  MatchServiceError, createFriendlyMatch, createLeague, getLeague, joinLeague,
  listClubMatches, listMatchOpponents, listOpenLeagues, startLeague, submitMatchCheckpointDecision, updateCompetitionRules,
} from "./match-service.js";
import {
  PyramidLeagueError, acceptFriendlyChallenge, applyForPyramidLeague, createFriendlyChallenge,
  getFriendlyChallengeInfo, getPyramidLeagueClubHistory, getPyramidLeagueDetails, listLeagueNotices, listPyramidLeagues,
  markLeagueNoticesRead, respondToPromotion,
} from "./league-pyramid-service.js";

const keySchema = z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/);
const competitionRulesSchema = z.object({
  maxSubstitutions: z.number().int().min(0).max(5),
  maxInPlayWindows: z.number().int().min(0).max(3),
  injuriesEnabled: z.boolean(),
  injuryDurationDays: z.number().int().min(1).max(14),
  redCardSuspensionMatches: z.number().int().min(0).max(5),
  yellowCardsToSuspend: z.number().int().min(0).max(10),
  yellowCardSuspensionMatches: z.number().int().min(0).max(5),
  penaltiesOnDraw: z.boolean(),
}).strict().refine((rules) => rules.maxInPlayWindows <= rules.maxSubstitutions
  && !(rules.yellowCardsToSuspend === 0 && rules.yellowCardSuspensionMatches > 0), {
  message: "INCONSISTENT_COMPETITION_RULES",
});
function sendMatchError(reply: FastifyReply, error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2034" || error.code === "P2002")) {
    return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
  }
  if (error instanceof PyramidLeagueError) {
    const notFound = ["CLUB_NOT_FOUND", "PYRAMID_LEAGUE_NOT_FOUND", "FRIENDLY_CHALLENGE_NOT_FOUND", "PROMOTION_OFFER_NOT_FOUND"];
    const forbidden = ["GROUP_MEMBERSHIP_REQUIRED"];
    const conflicts = ["CLUB_ALREADY_IN_ACTIVE_PYRAMID_LEAGUE", "APPLICATION_ALREADY_WITHDRAWN", "PROMOTION_OFFER_ALREADY_RESOLVED", "PROMOTION_OFFER_EXPIRED", "FRIENDLY_CHALLENGE_EXPIRED", "FRIENDLY_CHALLENGE_ALREADY_ACCEPTED", "CANNOT_ACCEPT_OWN_CHALLENGE", "NOT_PROMOTION_OFFER_OWNER", "NOT_PYRAMID_LEAGUE_MEMBER", "IDEMPOTENCY_CONFLICT", "DAILY_CHALLENGE_LIMIT_REACHED", "INSUFFICIENT_GOLD", "CONCURRENT_MODIFICATION", "GROUP_INACTIVE", "ALL_TEAMS_NEED_VALID_LINEUPS", "CLUB_ALREADY_HAS_MATCH_IN_WINDOW"];
    return reply.code(notFound.includes(error.code) ? 404 : forbidden.includes(error.code) ? 403 : conflicts.includes(error.code) ? 409 : 400).send({ error: error.code });
  }
  if (error instanceof MatchFallbackPlanError) {
    const status = error.code === "CLUB_NOT_FOUND" ? 404 : error.code === "FALLBACK_PLAN_VERSION_CONFLICT" ? 409 : 400;
    return reply.code(status).send({ error: error.code });
  }
  if (!(error instanceof MatchServiceError)) throw error;
  const notFound = ["CLUB_NOT_FOUND", "OPPONENT_NOT_FOUND", "COMPETITION_NOT_FOUND", "MATCH_NOT_FOUND"];
  const conflicts = [
    "IDEMPOTENCY_CONFLICT", "CLUB_ALREADY_HAS_MATCH_IN_WINDOW", "COMPETITION_NOT_OPEN",
    "COMPETITION_FULL", "ONLY_CREATOR_CAN_START", "COMPETITION_RULES_LOCKED", "LEAGUE_NEEDS_FOUR_TEAMS",
    "ALL_TEAMS_NEED_VALID_LINEUPS", "NOT_COMPETITION_MEMBER", "NOT_MATCH_PARTICIPANT",
    "MATCH_NOT_SCHEDULED", "MATCH_NOT_DUE", "MATCH_ALREADY_SIMULATED", "CONCURRENT_MODIFICATION",
    "MATCH_CHECKPOINT_CLOSED", "MATCH_CHECKPOINT_NOT_FOUND",
  ];
  const status = notFound.includes(error.code) ? 404 : conflicts.includes(error.code) ? 409 : 400;
  return reply.code(status).send({ error: error.code, ...(error.details ? { details: error.details } : {}) });
}
export function registerMatchRoutes(app: FastifyInstance) {
  app.get("/v1/matches/fallback-plan", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try { return await getMatchFallbackPlan(user.id); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.put("/v1/matches/fallback-plan", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = z.object({
      expectedVersion: z.number().int().min(1),
      plan: z.object({
        formation: z.enum(["4-3-3", "4-4-2", "3-5-2", "4-2-3-1"]),
        mentality: z.enum(["DEFENSIVE", "BALANCED", "ATTACKING"]),
        pressing: z.enum(["LOW_BLOCK", "MID_BLOCK", "HIGH_PRESS"]),
        tempo: z.enum(["SLOW", "NORMAL", "FAST"]),
        passingStyle: z.enum(["SHORT", "MIXED", "DIRECT"]),
      }).strict(),
    }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_FALLBACK_PLAN" });
    try { return await saveMatchFallbackPlan(user.id, body.data.plan, body.data.expectedVersion); }
    catch (error) { return sendMatchError(reply, error); }
  });

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
    // Keep the legacy endpoint fail-closed: user-triggered one-shot simulation
    // bypasses persisted checkpoints, substitutions and the automatic runtime.
    return reply.code(409).send({ error: "MATCH_RUNTIME_AUTOMATIC" });
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
      format: z.enum(["LEAGUE", "CUP"]).default("LEAGUE"), cupLegs: z.number().int().min(1).max(2).default(1), rules: competitionRulesSchema.optional(), idempotencyKey: keySchema,
    }).refine((value) => value.format === "CUP" || value.cupLegs === 1, { message: "INVALID_CUP_LEGS" }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_COMPETITION" });
    try { return await createLeague(user.id, body.data.name, body.data.maxTeams, body.data.idempotencyKey, body.data.format, body.data.rules, body.data.cupLegs); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.put("/v1/competitions/:id/rules", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params);
    const body = competitionRulesSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_COMPETITION_RULES" });
    try { return await updateCompetitionRules(user.id, params.data.id, body.data); }
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

  app.get("/v1/pyramid-leagues", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try { return await listPyramidLeagues(user.id); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.post("/v1/pyramid-leagues/apply", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const body = z.object({ tier: z.number().int().min(1).max(7) }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_PYRAMID_LEAGUE_APPLICATION" });
    try { return await applyForPyramidLeague(user.id, body.data.tier); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.get("/v1/pyramid-leagues/history", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try { return await getPyramidLeagueClubHistory(user.id); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.get("/v1/pyramid-leagues/:id", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_PYRAMID_LEAGUE_ID" });
    try { return await getPyramidLeagueDetails(user.id, params.data.id); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.post("/v1/pyramid-leagues/promotions/:offerId/respond", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ offerId: z.string().min(1).max(64) }).safeParse(request.params);
    const body = z.object({ accept: z.boolean() }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_PROMOTION_RESPONSE" });
    try { return await respondToPromotion(user.id, params.data.offerId, body.data.accept); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.get("/v1/league-notices", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    return await listLeagueNotices(user.id);
  });
  app.post("/v1/league-notices/read", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    return await markLeagueNoticesRead(user.id);
  });
  app.post("/v1/friendly-challenges", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    try {
      const body = z.object({ groupTelegramId: z.string().regex(/^-?\d{1,20}$/).optional(), idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/) }).strict().safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "INVALID_FRIENDLY_CHALLENGE" });
      if (body.data.groupTelegramId) {
        try {
          await verifyTelegramGroupActor({ telegramGroupId: body.data.groupTelegramId, telegramUserId: user.telegramId });
        } catch (error) {
          if (error instanceof TelegramGroupAuthorizationError) {
            const status = error.code === "TELEGRAM_BOT_TOKEN_NOT_CONFIGURED" ? 503
              : error.code === "TELEGRAM_GROUP_CHECK_FAILED" ? 502 : 403;
            return reply.code(status).send({ error: error.code });
          }
          throw error;
        }
      }
      const result = await createFriendlyChallenge(user.id, 100n, new Date(), body.data.groupTelegramId, body.data.idempotencyKey);
      const botUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
      return { ...result, shareUrl: botUsername ? `https://t.me/${botUsername}?start=challenge_${result.challenge.token}` : null };
    } catch (error) { return sendMatchError(reply, error); }
  });
  app.get("/v1/friendly-challenges/:token", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ token: z.string().min(10).max(100) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_FRIENDLY_CHALLENGE_TOKEN" });
    try { return await getFriendlyChallengeInfo(params.data.token); }
    catch (error) { return sendMatchError(reply, error); }
  });
  app.post("/v1/friendly-challenges/:token/accept", async (request, reply) => {
    const user = await requireTelegramUser(request);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    const params = z.object({ token: z.string().min(10).max(100) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_FRIENDLY_CHALLENGE_TOKEN" });
    try {
      const challenge = await getFriendlyChallengeInfo(params.data.token);
      if (challenge.groupTelegramId) {
        try {
          await verifyTelegramGroupActor({ telegramGroupId: challenge.groupTelegramId, telegramUserId: user.telegramId });
        } catch (error) {
          if (error instanceof TelegramGroupAuthorizationError) {
            const status = error.code === "TELEGRAM_BOT_TOKEN_NOT_CONFIGURED" ? 503
              : error.code === "TELEGRAM_GROUP_CHECK_FAILED" ? 502 : 403;
            return reply.code(status).send({ error: error.code });
          }
          throw error;
        }
      }
      return await acceptFriendlyChallenge(user.id, params.data.token);
    } catch (error) { return sendMatchError(reply, error); }
  });

}
