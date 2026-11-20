import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export interface MatchResultNotification {
  id: string; channel: string; telegramChatId: string; claimToken: string; attempt: number;
  match: { id: string; homeClub: string; awayClub: string; homeScore: number | null; awayScore: number | null;
    completedAt: string | null; statistics: { home: { shots:number; passes:number; tackles:number }; away: { shots:number; passes:number; tackles:number } };
    scorers: Array<{ player:string; goals:number }> };
}
export interface MatchLifecycleNotification {
  id: string; channel: string; telegramChatId: string; claimToken: string; attempt: number;
  kind: string; minute: number; homeScore: number | null; awayScore: number | null; payload: Record<string,unknown> | null;
  match: { id:string; homeClub:string; awayClub:string };
}
export interface MatchCheckpointNotification {
  checkpointId:string; matchId:string; checkpointKey:string; minute:number; deadlineAt:string;
  clubId:string; clubName:string; opponentName:string; telegramUserId:string; side:"HOME"|"AWAY"; attempt:number; claimToken:string;
}
export interface MatchNotificationPort {
  claimResults(limit:number): Promise<MatchResultNotification[]>;
  claimLifecycle(limit:number): Promise<MatchLifecycleNotification[]>;
  complete(type:"RESULT"|"LIFECYCLE",id:string,claimToken:string,delivered:boolean,error:string|null,retrySeconds:number): Promise<boolean>;
  claimCheckpoints(limit:number,checkpointId?:string): Promise<MatchCheckpointNotification[]>;
  acknowledgeCheckpoint(checkpointId:string,side:"HOME"|"AWAY",claimToken:string,delivered:boolean,error:string|null): Promise<boolean>;
}
function authenticateSystemBot(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected=process.env.BOT_API_SECRET; const received=request.headers["x-football-bot-secret"];
  if(!expected){reply.code(503).send({error:"BOT_AUTH_NOT_CONFIGURED"});return false;}
  const a=Buffer.from(typeof received==="string"?received:"");const b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b)){reply.code(401).send({error:"UNAUTHENTICATED_BOT_REQUEST"});return false;}
  return true;
}
export function registerMatchNotificationRoutes(app:FastifyInstance,repository?:MatchNotificationPort){
 const getRepository=()=>{if(!repository&&(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production"))throw new Error("MATCH_NOTIFICATION_SUPABASE_REPOSITORY_REQUIRED");return repository;};
 app.post("/v1/bot/match-results/claim",async(request,reply)=>{
  if(!authenticateSystemBot(request,reply))return;
  const parsed=z.object({limit:z.number().int().min(1).max(100).default(25)}).safeParse(request.body??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_MATCH_RESULT_CLAIM"});
  const repo=getRepository();if(!repo)return reply.code(503).send({error:"MATCH_NOTIFICATION_REPOSITORY_REQUIRED"});
  return {notifications:await repo.claimResults(parsed.data.limit)};
 });
 app.post("/v1/bot/match-results/ack",async(request,reply)=>{
  if(!authenticateSystemBot(request,reply))return;
  const parsed=z.object({id:z.string().min(1).max(64),claimToken:z.string().uuid(),delivered:z.boolean(),error:z.string().max(500).optional()}).strict().safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_MATCH_RESULT_ACK"});
  const repo=getRepository();if(!repo)return reply.code(503).send({error:"MATCH_NOTIFICATION_REPOSITORY_REQUIRED"});
  if(!await repo.complete("RESULT",parsed.data.id,parsed.data.claimToken,parsed.data.delivered,parsed.data.error??null,30))return reply.code(409).send({error:"MATCH_RESULT_CLAIM_EXPIRED"});
  return {acknowledged:true,delivered:parsed.data.delivered};
 });
 app.post("/v1/bot/match-lifecycle/claim",async(request,reply)=>{
  if(!authenticateSystemBot(request,reply))return;
  const parsed=z.object({limit:z.number().int().min(1).max(100).default(50)}).safeParse(request.body??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_MATCH_LIFECYCLE_CLAIM"});
  const repo=getRepository();if(!repo)return reply.code(503).send({error:"MATCH_NOTIFICATION_REPOSITORY_REQUIRED"});
  return {notifications:await repo.claimLifecycle(parsed.data.limit)};
 });
 app.post("/v1/bot/match-lifecycle/ack",async(request,reply)=>{
  if(!authenticateSystemBot(request,reply))return;
  const parsed=z.object({id:z.string().min(1).max(64),claimToken:z.string().uuid(),delivered:z.boolean(),error:z.string().max(500).optional()}).strict().safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_MATCH_LIFECYCLE_ACK"});
  const repo=getRepository();if(!repo)return reply.code(503).send({error:"MATCH_NOTIFICATION_REPOSITORY_REQUIRED"});
  if(!await repo.complete("LIFECYCLE",parsed.data.id,parsed.data.claimToken,parsed.data.delivered,parsed.data.error??null,15))return reply.code(409).send({error:"MATCH_LIFECYCLE_CLAIM_EXPIRED"});
  return {acknowledged:true,delivered:parsed.data.delivered};
 });
 app.post("/v1/bot/match-checkpoints/claim",async(request,reply)=>{
  if(!authenticateSystemBot(request,reply))return;
  const parsed=z.object({limit:z.number().int().min(1).max(100).default(25),checkpointId:z.string().min(1).max(64).optional()}).safeParse(request.body??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_MATCH_NOTIFICATION_CLAIM"});
  const repo=getRepository();if(!repo)return reply.code(503).send({error:"MATCH_NOTIFICATION_REPOSITORY_REQUIRED"});
  return {notifications:await repo.claimCheckpoints(parsed.data.limit,parsed.data.checkpointId)};
 });
 app.post("/v1/bot/match-checkpoints/ack",async(request,reply)=>{
  if(!authenticateSystemBot(request,reply))return;
  const parsed=z.object({checkpointId:z.string().min(1).max(64),side:z.enum(["HOME","AWAY"]),claimToken:z.string().uuid(),delivered:z.boolean(),error:z.string().max(500).optional()}).strict().safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:"INVALID_MATCH_NOTIFICATION_ACK"});
  const repo=getRepository();if(!repo)return reply.code(503).send({error:"MATCH_NOTIFICATION_REPOSITORY_REQUIRED"});
  if(!await repo.acknowledgeCheckpoint(parsed.data.checkpointId,parsed.data.side,parsed.data.claimToken,parsed.data.delivered,parsed.data.error??null))return reply.code(409).send({error:"MATCH_NOTIFICATION_CLAIM_EXPIRED"});
  return {acknowledged:true,delivered:parsed.data.delivered};
 });
}
