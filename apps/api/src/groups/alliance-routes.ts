import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import { AllianceServiceError, closeAllianceSeason, createAlliance, createAllianceChampionship, getAllianceWorkspace, inviteAllianceGroup, joinAllianceChampionship, respondAllianceInvitation, startAllianceChampionship, startAllianceSeason } from "./alliance-service.js";

function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AllianceServiceError)) {
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2034" || error.code === "P2002")) return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
    throw error;
  }
  const notFound = ["ACCOUNT_NOT_FOUND","CLUB_NOT_FOUND","GROUP_NOT_REGISTERED","TARGET_GROUP_NOT_FOUND","INVITATION_NOT_FOUND","COMPETITION_NOT_FOUND","NO_ACTIVE_SEASON"];
  const forbidden = ["GROUP_MANAGER_REQUIRED","ALLIANCE_FOUNDER_REQUIRED","ONLY_CREATOR_CAN_START"];
  const conflict = ["GROUP_ALREADY_IN_ALLIANCE","TARGET_ALREADY_IN_ALLIANCE","ALLIANCE_NOT_FOUND","ALLIANCE_INACTIVE","GROUP_INACTIVE","TARGET_GROUP_INACTIVE","COMPETITION_NOT_OPEN","COMPETITION_FULL","SEASON_ALREADY_ACTIVE"];
  return reply.code(notFound.includes(error.code) ? 404 : forbidden.includes(error.code) ? 403 : conflict.includes(error.code) ? 409 : 422).send({ error: error.code });
}
const groupId = z.string().regex(/^-?\d{1,20}$/);
const key = z.string().regex(/^[A-Za-z0-9_-]{12,64}$/);
export function registerAllianceRoutes(app: FastifyInstance) {
  const actor = async (request: Parameters<typeof requireTelegramUser>[0], reply: FastifyReply) => {
    const user = await requireTelegramUser(request);
    if (!user) { reply.code(401).send({ error: "UNAUTHENTICATED" }); return null; }
    return user.telegramId;
  };
  app.get("/v1/alliances/:telegramGroupId", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_GROUP_ID"}); try{return await getAllianceWorkspace(id,p.data.telegramGroupId);}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params), b=z.object({name:z.string().trim().min(3).max(60),description:z.string().max(300).optional(),idempotencyKey:key}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_ALLIANCE"}); try{return await createAlliance({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/invitations", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params), b=z.object({targetTelegramGroupId:groupId}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_INVITATION"}); try{return await inviteAllianceGroup({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/invitations/:invitationId/respond", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId,invitationId:z.string().min(1).max(64)}).safeParse(request.params), b=z.object({accept:z.boolean()}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_INVITATION_RESPONSE"}); try{return await respondAllianceInvitation({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/championships", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params), b=z.object({name:z.string().trim().min(3).max(60),maxTeams:z.number().int().min(4).max(20),idempotencyKey:key}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_CHAMPIONSHIP"}); try{return await createAllianceChampionship({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/championships/:competitionId/join", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(64)}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_COMPETITION_ID"}); try{return await joinAllianceChampionship({telegramUserId:id,...p.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/championships/:competitionId/start", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(64)}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_COMPETITION_ID"}); try{return await startAllianceChampionship({telegramUserId:id,...p.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/seasons", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params), b=z.object({durationDays:z.number().int().min(7).max(90)}).safeParse(request.body); if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_SEASON"}); try{return await startAllianceSeason({telegramUserId:id,...p.data,...b.data});}catch(e){return sendError(reply,e);} });
  app.post("/v1/alliances/:telegramGroupId/seasons/close", async (request, reply) => { const id=await actor(request,reply); if(!id)return; const p=z.object({telegramGroupId:groupId}).safeParse(request.params); if(!p.success)return reply.code(400).send({error:"INVALID_GROUP_ID"}); try{return await closeAllianceSeason({telegramUserId:id,...p.data});}catch(e){return sendError(reply,e);} });
}
