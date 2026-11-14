import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { awardDailyGroupActivity, getTelegramGroupSummary, GroupServiceError, joinTelegramGroup, registerTelegramGroup, listGroupShop, purchaseGroupReward, listGroupChallenges, createGroupChallenge, joinGroupChallenge, completeGroupChallenge, checkTelegramGroupMembers, createGroupLeague, joinGroupLeague, startGroupLeague, getGroupLeagueTable, recordGroupGameActivity, listMyTelegramGroups, getGroupWorkspace, cancelGroupChallenge, listGroupLeagues } from "./group-service.js";
import { requireTelegramUser } from "../auth/require-telegram-user.js";
import { prisma } from "../db.js";

async function authenticateBot(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const expected = process.env.BOT_API_SECRET;
  const received = request.headers["x-football-bot-secret"];
  const telegramId = request.headers["x-telegram-user-id"];
  if (!expected) { reply.code(503).send({ error: "BOT_AUTH_NOT_CONFIGURED" }); return null; }
  const a = Buffer.from(typeof received === "string" ? received : "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b) || typeof telegramId !== "string" || !/^\d{1,20}$/.test(telegramId)) {
    reply.code(401).send({ error: "UNAUTHENTICATED_BOT_REQUEST" }); return null;
  }
  const account = await prisma.user.findUnique({ where: { telegramId }, select: { isSuspended: true } });
  if (!account || account.isSuspended) { reply.code(403).send({ error: "PLAYER_ACCOUNT_SUSPENDED" }); return null; }
  const rawGroupId = (request.params as { telegramGroupId?: string }).telegramGroupId
    ?? (request.body as { telegramGroupId?: string } | null)?.telegramGroupId;
  if (rawGroupId) {
    const group = await prisma.telegramGroup.findUnique({ where: { telegramId: rawGroupId }, select: { isSuspended: true } });
    if (group?.isSuspended) { reply.code(403).send({ error: "TELEGRAM_GROUP_SUSPENDED" }); return null; }
  }
  return telegramId;
}

async function authenticateGroupActor(request:FastifyRequest,reply:FastifyReply):Promise<string|null>{
 const expected=process.env.BOT_API_SECRET,received=request.headers["x-football-bot-secret"],telegramId=request.headers["x-telegram-user-id"];
 if(expected&&typeof received==="string"){const a=Buffer.from(received),b=Buffer.from(expected);if(a.length===b.length&&timingSafeEqual(a,b)&&typeof telegramId==="string"&&/^\d{1,20}$/.test(telegramId)){const user=await requireTelegramUser(request);if(!user){reply.code(403).send({error:"PLAYER_ACCOUNT_SUSPENDED"});return null;}const gid=(request.params as {telegramGroupId?:string}).telegramGroupId??(request.body as {telegramGroupId?:string}|null)?.telegramGroupId;if(gid){const group=await prisma.telegramGroup.findUnique({where:{telegramId:gid},select:{isSuspended:true}});if(group?.isSuspended){reply.code(403).send({error:"TELEGRAM_GROUP_SUSPENDED"});return null;}}return telegramId;}}
 const user=await requireTelegramUser(request);if(!user){reply.code(401).send({error:"UNAUTHENTICATED"});return null;}return user.telegramId;
}
function authenticateSystemBot(request:FastifyRequest,reply:FastifyReply):boolean{
 const expected=process.env.BOT_API_SECRET,received=request.headers["x-football-bot-secret"];if(!expected){reply.code(503).send({error:"BOT_AUTH_NOT_CONFIGURED"});return false;}
 const a=Buffer.from(typeof received==="string"?received:""),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b)){reply.code(401).send({error:"UNAUTHENTICATED_BOT_REQUEST"});return false;}return true;
}

function sendGroupError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof GroupServiceError)) {
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2034" || error.code === "P2002")) return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
    throw error;
  }
  const status = ["ACCOUNT_NOT_FOUND","CLUB_NOT_FOUND","GROUP_NOT_REGISTERED","GROUP_REWARD_NOT_FOUND","CHALLENGE_NOT_FOUND","COMPETITION_NOT_FOUND"].includes(error.code)?404:["NOT_GROUP_MEMBER","GROUP_MANAGER_REQUIRED","RECIPIENT_NOT_GROUP_MEMBER","WINNER_NOT_PARTICIPANT"].includes(error.code)?403:["GROUP_MINIMUM_MEMBERS_REQUIRED","INSUFFICIENT_GROUP_POINTS","INVALID_CHALLENGE_REWARD"].includes(error.code)?422:["GROUP_INACTIVE","CHALLENGE_NOT_OPEN","CHALLENGE_NOT_READY","CHALLENGE_ALREADY_SETTLED","IDEMPOTENCY_CONFLICT","COMPETITION_NOT_OPEN","COMPETITION_FULL"].includes(error.code)?409:400;
  return reply.code(status).send({ error: error.code, ...(error.code === "GROUP_MINIMUM_MEMBERS_REQUIRED" ? { minimumMembers: 10 } : {}) });
}
const groupId = z.string().regex(/^-?\d{1,20}$/);
export function registerGroupRoutes(app: FastifyInstance) {

  app.get("/v1/groups/mine",async(request,reply)=>{const user=await requireTelegramUser(request);if(!user)return reply.code(401).send({error:"UNAUTHENTICATED"});return listMyTelegramGroups(user.id);});
  app.get("/v1/groups/:telegramGroupId/workspace",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"INVALID_GROUP_ID"});try{return await getGroupWorkspace(id,p.data.telegramGroupId);}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/challenges/:challengeId/cancel",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId,challengeId:z.string().min(1).max(64)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"INVALID_CHALLENGE_ID"});try{return await cancelGroupChallenge({telegramUserId:id,...p.data});}catch(e){return sendGroupError(reply,e);}});
  app.get("/v1/groups/:telegramGroupId/leagues",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"INVALID_GROUP_ID"});try{return await listGroupLeagues(id,p.data.telegramGroupId);}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/activity/award",async(request,reply)=>{const id=await authenticateBot(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId}).safeParse(request.params),b=z.object({activityType:z.enum(["CHALLENGE_JOIN","CHALLENGE_CREATE","LEAGUE_JOIN","LEAGUE_CREATE","MATCH_PLAYED"]),referenceId:z.string().min(1).max(80).regex(/^[A-Za-z0-9:_-]+$/)}).safeParse(request.body);if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_GROUP_ACTIVITY"});try{return await recordGroupGameActivity({telegramUserId:id,...p.data,...b.data});}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/system/member-count",async(request,reply)=>{if(!authenticateSystemBot(request,reply))return;const b=z.object({telegramGroupId:groupId,memberCount:z.number().int().min(0).max(1000000)}).safeParse(request.body);if(!b.success)return reply.code(400).send({error:"INVALID_GROUP_CHECK"});return checkTelegramGroupMembers(b.data.telegramGroupId,b.data.memberCount);});

  app.post("/v1/groups/register", async (request, reply) => {
    const telegramUserId = await authenticateBot(request, reply); if (!telegramUserId) return;
    const parsed = z.object({ telegramGroupId: groupId, title: z.string().trim().min(1).max(255), role: z.enum(["OWNER", "ADMIN"]), memberCount: z.number().int().min(0).max(1_000_000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_GROUP_REGISTRATION" });
    try { return { registration: await registerTelegramGroup({ telegramUserId, ...parsed.data }) }; } catch (error) { return sendGroupError(reply, error); }
  });
  app.post("/v1/groups/join", async (request, reply) => {
    const telegramUserId = await authenticateBot(request, reply); if (!telegramUserId) return;
    const parsed = z.object({ telegramGroupId: groupId, memberCount: z.number().int().min(0).max(1_000_000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_GROUP_JOIN" });
    try { return { membership: await joinTelegramGroup({ telegramUserId, ...parsed.data }) }; } catch (error) { return sendGroupError(reply, error); }
  });
  app.post("/v1/groups/activity", async (request, reply) => {
    const telegramUserId = authenticateBot(request, reply); if (!telegramUserId) return;
    const parsed = z.object({ telegramGroupId: groupId }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_GROUP_ACTIVITY" });
    try { return { activity: await awardDailyGroupActivity({ telegramUserId, ...parsed.data }) }; } catch (error) { return sendGroupError(reply, error); }
  });

  app.get("/v1/groups/:telegramGroupId/shop",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"INVALID_GROUP_ID"});try{return await listGroupShop(id,p.data.telegramGroupId);}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/shop/purchase",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId}).safeParse(request.params),b=z.object({itemSlug:z.string().min(1).max(64),recipientTelegramId:z.string().regex(/^\d{1,20}$/).optional(),idempotencyKey:z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/)}).safeParse(request.body);if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_GROUP_PURCHASE"});try{return await purchaseGroupReward({telegramUserId:id,telegramGroupId:p.data.telegramGroupId,itemSlug:b.data.itemSlug,idempotencyKey:b.data.idempotencyKey,...(b.data.recipientTelegramId?{recipientTelegramId:b.data.recipientTelegramId}:{})});}catch(e){return sendGroupError(reply,e);}});
  app.get("/v1/groups/:telegramGroupId/challenges",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"INVALID_GROUP_ID"});try{return await listGroupChallenges(id,p.data.telegramGroupId);}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/challenges",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId}).safeParse(request.params),b=z.object({title:z.string().trim().min(3).max(80),startsAt:z.string().datetime(),endsAt:z.string().datetime(),rewardPoints:z.string().regex(/^\d{1,12}$/),idempotencyKey:z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/)}).safeParse(request.body);if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_GROUP_CHALLENGE"});try{return await createGroupChallenge({telegramUserId:id,...p.data,title:b.data.title,startsAt:new Date(b.data.startsAt),endsAt:new Date(b.data.endsAt),rewardPoints:BigInt(b.data.rewardPoints),idempotencyKey:b.data.idempotencyKey});}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/challenges/:challengeId/join",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId,challengeId:z.string().min(1).max(64)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"INVALID_CHALLENGE_ID"});try{return await joinGroupChallenge({telegramUserId:id,...p.data});}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/challenges/:challengeId/complete",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId,challengeId:z.string().min(1).max(64)}).safeParse(request.params),b=z.object({winnerTelegramId:z.string().regex(/^\d{1,20}$/)}).safeParse(request.body);if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_CHALLENGE_RESULT"});try{return await completeGroupChallenge({telegramUserId:id,...p.data,...b.data});}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/check",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId}).safeParse(request.params),b=z.object({memberCount:z.number().int().min(0).max(1000000)}).safeParse(request.body);if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_GROUP_CHECK"});try{const s=await getTelegramGroupSummary(id,p.data.telegramGroupId);if(s.role==="MEMBER")return reply.code(403).send({error:"GROUP_MANAGER_REQUIRED"});return await checkTelegramGroupMembers(p.data.telegramGroupId,b.data.memberCount);}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/leagues",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId}).safeParse(request.params),b=z.object({name:z.string().trim().min(3).max(40),maxTeams:z.number().int().min(4).max(10),idempotencyKey:z.string().regex(/^[A-Za-z0-9:_-]{12,128}$/)}).safeParse(request.body);if(!p.success||!b.success)return reply.code(400).send({error:"INVALID_GROUP_LEAGUE"});try{return await createGroupLeague({telegramUserId:id,...p.data,...b.data});}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/leagues/:competitionId/join",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(64)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"INVALID_COMPETITION_ID"});try{return await joinGroupLeague({telegramUserId:id,...p.data});}catch(e){return sendGroupError(reply,e);}});
  app.post("/v1/groups/:telegramGroupId/leagues/:competitionId/start",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(64)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"INVALID_COMPETITION_ID"});try{return await startGroupLeague({telegramUserId:id,...p.data});}catch(e){return sendGroupError(reply,e);}});
  app.get("/v1/groups/:telegramGroupId/leagues/:competitionId",async(request,reply)=>{const id=await authenticateGroupActor(request,reply);if(!id)return;const p=z.object({telegramGroupId:groupId,competitionId:z.string().min(1).max(64)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"INVALID_COMPETITION_ID"});try{return await getGroupLeagueTable(id,p.data.telegramGroupId,p.data.competitionId);}catch(e){return sendGroupError(reply,e);}});

  app.get("/v1/groups/:telegramGroupId", async (request, reply) => {
    const telegramUserId = authenticateBot(request, reply); if (!telegramUserId) return;
    const parsed = z.object({ telegramGroupId: groupId }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_GROUP_ID" });
    try { return await getTelegramGroupSummary(telegramUserId, parsed.data.telegramGroupId); } catch (error) { return sendGroupError(reply, error); }
  });
}
