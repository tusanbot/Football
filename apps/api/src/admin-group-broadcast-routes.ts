import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance,FastifyReply,FastifyRequest } from "fastify";
import { z } from "zod";
export interface AdminGroupBroadcastDelivery {id:string;telegramGroupId:string;message:string;claimToken:string;attempt:number;}
export interface AdminGroupBroadcastPort {
 claim(limit:number):Promise<AdminGroupBroadcastDelivery[]>;
 complete(id:string,claimToken:string):Promise<boolean>;
 fail(id:string,claimToken:string,error:string):Promise<{rescheduled:boolean;attempts:number}|null>;
}
function authenticate(request:FastifyRequest,reply:FastifyReply):boolean{
 const expected=process.env.BOT_API_SECRET;const received=request.headers["x-football-bot-secret"];
 if(!expected){reply.code(503).send({error:"BOT_AUTH_NOT_CONFIGURED"});return false;}
 const a=Buffer.from(typeof received==="string"?received:"");const b=Buffer.from(expected);
 if(a.length!==b.length||!timingSafeEqual(a,b)){reply.code(401).send({error:"UNAUTHENTICATED_BOT_REQUEST"});return false;}return true;
}
export function registerAdminGroupBroadcastRoutes(app:FastifyInstance,repository?:AdminGroupBroadcastPort){
 const getRepository=()=>{if(!repository&&(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production"))throw new Error("ADMIN_GROUP_BROADCAST_SUPABASE_REPOSITORY_REQUIRED");return repository;};
 app.post("/v1/bot/admin-group-broadcasts/claim",async(request,reply)=>{
  if(!authenticate(request,reply))return;const parsed=z.object({limit:z.number().int().min(1).max(100).default(20)}).safeParse(request.body??{});
  if(!parsed.success)return reply.code(400).send({error:"INVALID_BROADCAST_CLAIM"});
  const repo=getRepository();if(!repo)return reply.code(503).send({error:"ADMIN_GROUP_BROADCAST_REPOSITORY_REQUIRED"});
  return {deliveries:await repo.claim(parsed.data.limit)};
 });
 app.post("/v1/bot/admin-group-broadcasts/:id/complete",async(request,reply)=>{
  if(!authenticate(request,reply))return;const params=z.object({id:z.string().min(1).max(128)}).safeParse(request.params);
  const body=z.object({claimToken:z.string().uuid()}).safeParse(request.body);
  if(!params.success||!body.success)return reply.code(400).send({error:"INVALID_BROADCAST_COMPLETION"});
  const repo=getRepository();if(!repo)return reply.code(503).send({error:"ADMIN_GROUP_BROADCAST_REPOSITORY_REQUIRED"});
  if(!await repo.complete(params.data.id,body.data.claimToken))return reply.code(409).send({error:"BROADCAST_CLAIM_NOT_OWNED"});
  return {completed:true};
 });
 app.post("/v1/bot/admin-group-broadcasts/:id/fail",async(request,reply)=>{
  if(!authenticate(request,reply))return;const params=z.object({id:z.string().min(1).max(128)}).safeParse(request.params);
  const body=z.object({claimToken:z.string().uuid(),error:z.string().trim().min(1).max(500)}).safeParse(request.body);
  if(!params.success||!body.success)return reply.code(400).send({error:"INVALID_BROADCAST_FAILURE"});
  const repo=getRepository();if(!repo)return reply.code(503).send({error:"ADMIN_GROUP_BROADCAST_REPOSITORY_REQUIRED"});
  const result=await repo.fail(params.data.id,body.data.claimToken,body.data.error);
  if(!result)return reply.code(409).send({error:"BROADCAST_CLAIM_NOT_OWNED"});
  return result;
 });
}
