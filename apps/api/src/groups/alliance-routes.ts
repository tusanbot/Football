import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import { verifyTelegramGroupActor, TelegramGroupAuthorizationError } from "./telegram-group-authorization.js";
import { consumeAllianceActionRateLimit } from "./alliance-rate-limit.js";
import { getAlliancePort, type AlliancePort } from "./alliance-context.js";
import { AllianceServiceError, closeAllianceSeason, contributeAllianceTreasury, createAlliance, createAllianceChampionship, getAllianceWorkspace, inviteAllianceGroup, joinAllianceChampionship, respondAllianceInvitation, reviewAllianceSeason, startAllianceChampionship, startAllianceSeason, createCrossAllianceCompetition, inviteCrossAllianceCompetition, respondCrossAllianceCompetitionInvitation, joinCrossAllianceCompetition, startCrossAllianceCompetition } from "./alliance-service.js";

function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AllianceServiceError)) {
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2034" || error.code === "P2002")) return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
    throw error;
  }
  const notFound = ["ACCOUNT_NOT_FOUND","CLUB_NOT_FOUND","GROUP_NOT_REGISTERED","TARGET_GROUP_NOT_FOUND","INVITATION_NOT_FOUND","COMPETITION_NOT_FOUND","NO_ACTIVE_SEASON","SEASON_NOT_FOUND","TARGET_ALLIANCE_NOT_FOUND"];
  const forbidden = ["GROUP_MANAGER_REQUIRED","ALLIANCE_FOUNDER_REQUIRED","ONLY_CREATOR_CAN_START","NOT_GROUP_MEMBER","ALLIANCE_REVIEWER_REQUIRED"];
  const conflict = ["GROUP_ALREADY_IN_ALLIANCE","TARGET_ALREADY_IN_ALLIANCE","ALLIANCE_NOT_FOUND","ALLIANCE_INACTIVE","GROUP_INACTIVE","TARGET_GROUP_INACTIVE","COMPETITION_NOT_OPEN","COMPETITION_FULL","SEASON_ALREADY_ACTIVE","INSUFFICIENT_GROUP_POINTS","IDEMPOTENCY_CONFLICT","SEASON_NOT_ENDED","SEASON_REVIEW_REQUIRED","SEASON_ALREADY_SETTLED","SEASON_NOT_FLAGGED","ALLIANCE_NOT_INVITED","CROSS_ALLIANCE_NEEDS_TWO_ALLIANCES","COMPETITION_WAITING_FOR_TEAMS","PARTICIPANT_SEASON_UNAVAILABLE","TARGET_SEASON_UNAVAILABLE","CANNOT_INVITE_SELF"];
  return reply.code(notFound.includes(error.code) ? 404 : forbidden.includes(error.code) ? 403 : conflict.includes(error.code) ? 409 : 422).send({ error: error.code });
}
const groupId = z.string().regex(/^-?\d{1,20}$/);
const key = z.string().regex(/^[A-Za-z0-9_-]{12,64}$/);
export function registerAllianceRoutes(app: FastifyInstance, options: { requirePort?: boolean; port?: AlliancePort } = {}) {
  const actor = async (request: FastifyRequest, reply: FastifyReply, requireManager = true) => {
    if (options.requirePort && (!options.port || !getAlliancePort())) { reply.code(503).send({ error: "ALLIANCE_SUPABASE_PORT_REQUIRED" }); return null; }
    const params = z.object({ telegramGroupId: groupId }).safeParse(request.params);
    if (!params.success) { reply.code(400).send({ error: "INVALID_GROUP_ID" }); return null; }
    const expected = process.env.BOT_API_SECRET, received = request.headers["x-football-bot-secret"], telegramId = request.headers["x-telegram-user-id"];
    let id: string | null = null;
    if (expected && typeof received === "string") {
      const a = Buffer.from(received), b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b) && typeof telegramId === "string" && /^\d{1,20}$/.test(telegramId)) id = telegramId;
    }
    if (!id) {
      const user = await requireTelegramUser(request);
      if (!user) { reply.code(401).send({ error: "UNAUTHENTICATED" }); return null; }
      id = user.telegramId;
    }
    try {
      await verifyTelegramGroupActor({ telegramGroupId: params.data.telegramGroupId, telegramUserId: id, requireManager });
    } catch (error) {
      if (error instanceof TelegramGroupAuthorizationError) {
        const status = error.code === "TELEGRAM_GROUP_MANAGER_REQUIRED" || error.code === "TELEGRAM_GROUP_ACCESS_REVOKED" || error.code === "TELEGRAM_BOT_NOT_GROUP_ADMIN" ? 403 : error.code === "TELEGRAM_BOT_TOKEN_NOT_CONFIGURED" ? 503 : 502;
        reply.code(status).send({ error: error.code }); return null;
      }
      throw error;
    }
    if (request.method === "POST") {
      const routeKey = request.routeOptions.url ?? request.url.split("?")[0] ?? "unknown";
      const limit = /treasury|seasons|invitations/.test(routeKey) ? 4 : 10;
      const port = getAlliancePort();
      const allowed = port ? await port.consumeRateLimit({ telegramUserId: id, telegramGroupId: params.data.telegramGroupId, action: routeKey, limit, now: new Date().toISOString() }) : await consumeAllianceActionRateLimit({ telegramUserId: id, telegramGroupId: params.data.telegramGroupId, action: routeKey, limit });
      if (!allowed) {
        reply.code(429).send({ error: "ALLIANCE_RATE_LIMITED", retryAfterSeconds: 60 }); return null;
      }
    }
    return id;
  };
  app.get("/v1/alliances/:telegramGroupId", async (request, reply) => { const id=await actor(request,reply,false); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_GROUP_ID"}); try{return await getAllianceWorkspace(id,p.data.telegramGroupId);}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params), b=z.object({name:z.string().trim().min(3).max(60),description:z.string().max(300).optional(),idempotencyKey:key}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_ALLIANCE"}); try{return await createAlliance({telegramUserId:id,...p.data,name:b.data.name,idempotencyKey:b.data.idempotencyKey,...(b.data.description ? { description: b.data.description } : {})});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/invitations", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params), b=z.object({targetTelegramGroupId:groupId}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_INVITATION"}); try{return await inviteAllianceGroup({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/invitations/:invitationId/respond", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId,invitationId:z.string().min(1).max(64)}).safeParse(request.params), b=z.object({accept:z.boolean()}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_INVITATION_RESPONSE"}); try{return await respondAllianceInvitation({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/championships", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params), b=z.object({name:z.string().trim().min(3).max(60),maxTeams:z.number().int().min(4).max(20),idempotencyKey:key}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_CHAMPIONSHIP"}); try{return await createAllianceChampionship({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/championships/:competitionId/join", async (request, reply) => { const id=await actor(request,reply,false); if(!id)return; const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(64)}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_COMPETITION_ID"}); try{return await joinAllianceChampionship({telegramUserId:id,...p.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/championships/:competitionId/start", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(64)}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_COMPETITION_ID"}); try{return await startAllianceChampionship({telegramUserId:id,...p.data});}catch(e){return sendError(reply,e);} });

  app.post("/v1/alliances/:telegramGroupId/cross-competitions", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params), b=z.object({name:z.string().trim().min(3).max(60),maxTeams:z.number().int().min(4).max(20),idempotencyKey:key}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_CHAMPIONSHIP"}); try{return await createCrossAllianceCompetition({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/cross-competitions/:competitionId/invitations", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(100)}).safeParse(request.params), b=z.object({targetAllianceSlug:z.string().min(12).max(64)}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_INVITATION"}); try{return await inviteCrossAllianceCompetition({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/cross-competitions/:competitionId/respond", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(100)}).safeParse(request.params), b=z.object({accept:z.boolean()}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_INVITATION_RESPONSE"}); try{return await respondCrossAllianceCompetitionInvitation({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/cross-competitions/:competitionId/join", async (request, reply) => { const id=await actor(request,reply,false); if(!id)return; const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(100)}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_COMPETITION_ID"}); try{return await joinCrossAllianceCompetition({telegramUserId:id,...p.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/cross-competitions/:competitionId/start", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(100)}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_COMPETITION_ID"}); try{return await startCrossAllianceCompetition({telegramUserId:id,...p.data});}catch(e){return sendError(reply,e);} });

  app.post("/v1/alliances/:telegramGroupId/treasury/contribute", async (request, reply) => {
    const id=await actor(request,reply); if(!id)return;
    const p=z.object({telegramGroupId:groupId}).safeParse(request.params);
    const b=z.object({amount:z.string().regex(/^\d{1,12}$/),idempotencyKey:key}).safeParse(request.body);
    if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_TREASURY_CONTRIBUTION"});
    try{return await contributeAllianceTreasury({telegramUserId:id,...p.data,amount:BigInt(b.data.amount),idempotencyKey:b.data.idempotencyKey});}catch(e){return sendError(reply,e);}
  });
  app.post("/v1/alliances/:telegramGroupId/seasons", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params), b=z.object({durationDays:z.number().int().min(7).max(90).optional()}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_SEASON"}); try{return await startAllianceSeason({telegramUserId:id,...p.data,...(b.data.durationDays!==undefined?{durationDays:b.data.durationDays}:{})});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/seasons/:seasonId/review", async (request, reply) => {
    const id=await actor(request,reply); if(!id)return;
    const p=z.object({telegramGroupId:groupId,seasonId:z.string().min(1).max(64)}).safeParse(request.params);
    const b=z.object({decision:z.enum(["APPROVE","REJECT"])}).safeParse(request.body);
    if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_SEASON_REVIEW"});
    try{return await reviewAllianceSeason({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);}
  });
  app.post("/v1/alliances/:telegramGroupId/seasons/close", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_GROUP_ID"}); try{return await closeAllianceSeason({telegramUserId:id,...p.data});}catch(e){return sendError(reply,e);} });
}
