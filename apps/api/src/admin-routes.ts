import type {FastifyInstance,FastifyReply,FastifyRequest} from "fastify";
import {z} from "zod";
import {prisma} from "./db.js";
import {requireTelegramUser} from "./auth/require-telegram-user.js";
import {consumeAllianceActionRateLimit} from "./groups/alliance-rate-limit.js";
import {parseAdminTelegramIds} from "./runtime-config.js";
import type { AdminRoleAssignment, AdminRoleLookupPort } from "./admin-role-context.js";
import type { AdminConfigurationPort } from "./node-supabase-admin-configuration.js";
import {adminCloseAllianceSeasonInTransaction,adminReviewAllianceSeasonInTransaction,adminStartAllianceSeasonInTransaction} from "./groups/alliance-service.js";
import type { AdminAlliancePort } from "./groups/node-supabase-alliance.js";
import type { AdminConsoleReadPort, AdminResourceListName } from "./node-supabase-admin-console-read.js";
import type { AdminModerationActionPort } from "./node-supabase-admin-moderation-actions.js";
import type { AdminCatalogActionPort } from "./node-supabase-admin-catalog-actions.js";
import type { AdminEntityUpdatePort } from "./node-supabase-admin-entity-update.js";
import type { AdminFinancialAdjustmentPort } from "./node-supabase-admin-financial-adjustments.js";
import type { AdminBroadcastRetryPort } from "./node-supabase-admin-broadcast-management.js";
import type { AdminSeasonAwardActionPort } from "./node-supabase-admin-season-awards.js";
import type { AdminBroadcastCreatePort } from "./node-supabase-admin-broadcast-create.js";
type AdminPermission="read"|"players"|"clubs"|"matches"|"competitions"|"economy"|"groups"|"moderation"|"gifts";
const ROLE_PERMISSIONS:Record<string,AdminPermission[]>={superadmin:["read","players","clubs","matches","competitions","economy","groups","moderation","gifts"],football:["read","players","clubs","matches","competitions"],economy:["read","economy","gifts"],moderator:["read","groups","moderation"]};
async function adminRoleFor(telegramId:string,port?:AdminRoleLookupPort){const superAdmins=parseAdminTelegramIds(process.env.GAME_ADMIN_TELEGRAM_IDS);if(superAdmins.includes(telegramId))return "superadmin";let assigned: AdminRoleAssignment | null;if(port)assigned=await port.getAssignment(telegramId);else{if(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production")throw new Error("ADMIN_ROLE_SUPABASE_REPOSITORY_REQUIRED");assigned=await prisma.adminRoleAssignment.findUnique({where:{telegramId},select:{role:true,active:true}});}if(assigned)return assigned.active&&Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS,assigned.role)?assigned.role:null;try{const map=JSON.parse(process.env.GAME_ADMIN_ROLE_MAP??"{}") as Record<string,string>;const role=map[telegramId];return role&&Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS,role)?role:null;}catch{return null;}}
async function authorize(req:FastifyRequest,reply:FastifyReply,permission:AdminPermission="read",port?:AdminRoleLookupPort){const u=await requireTelegramUser(req);if(!u){reply.code(401).send({error:"UNAUTHENTICATED"});return null;}const role=await adminRoleFor(u.telegramId,port);if(!role||!ROLE_PERMISSIONS[role]?.includes(permission)){reply.code(403).send({error:"ADMIN_PERMISSION_REQUIRED",permission});return null;}return {...u,adminRole:role};}
const querySchema=z.object({q:z.string().trim().max(100).optional(),season:z.coerce.number().int().min(2020).max(2200).optional(),limit:z.coerce.number().int().min(1).max(100).default(40)});
export function assertManualCompetitionStatus(status:string){if(status==="COMPLETED")throw new Error("COMPETITION_COMPLETION_AUTOMATIC_ONLY");if(status==="ACTIVE")throw new Error("COMPETITION_ACTIVATION_AUTOMATIC_ONLY");if(status!=="CANCELLED")throw new Error("COMPETITION_STATUS_MANUAL_CANCELLATION_ONLY");}
export function registerAdminRoutes(app:FastifyInstance,options:{adminAlliancePort?:AdminAlliancePort;adminRoleLookupPort?:AdminRoleLookupPort;adminConfigurationPort?:AdminConfigurationPort;adminConsoleReadPort?:AdminConsoleReadPort;adminModerationActionPort?:AdminModerationActionPort;adminCatalogActionPort?:AdminCatalogActionPort;adminEntityUpdatePort?:AdminEntityUpdatePort;adminFinancialAdjustmentPort?:AdminFinancialAdjustmentPort;adminBroadcastRetryPort?:AdminBroadcastRetryPort;adminSeasonAwardActionPort?:AdminSeasonAwardActionPort;adminBroadcastCreatePort?:AdminBroadcastCreatePort}={}){
const authorizeAdmin=(req:FastifyRequest,reply:FastifyReply,permission:AdminPermission="read")=>authorize(req,reply,permission,options.adminRoleLookupPort);
app.get("/v1/admin/overview",async(req,reply)=>{if(!await authorizeAdmin(req,reply))return;if(!options.adminConsoleReadPort)throw new Error("ADMIN_CONSOLE_SUPABASE_REPOSITORY_REQUIRED");return options.adminConsoleReadPort.overview();});
app.get("/v1/admin/group-targets",async(req,reply)=>{const actor=await authorizeAdmin(req,reply);if(!actor)return;if(actor.adminRole!=="superadmin")return reply.code(403).send({error:"SUPERADMIN_REQUIRED"});if(!options.adminConsoleReadPort)throw new Error("ADMIN_CONSOLE_SUPABASE_REPOSITORY_REQUIRED");return options.adminConsoleReadPort.groupTargets();});
app.post("/v1/admin/group-broadcasts/:id/retry-failed",async(req,reply)=>{
const actor=await authorizeAdmin(req,reply,"moderation");if(!actor)return;
if(actor.adminRole!=="superadmin")return reply.code(403).send({error:"SUPERADMIN_REQUIRED"});
if(!options.adminAlliancePort)throw new Error("ADMIN_ALLIANCE_SUPABASE_REPOSITORY_REQUIRED");
if(!await options.adminAlliancePort.consumeRateLimit({telegramUserId:actor.telegramId,telegramGroupId:"global",action:"admin-group-broadcast-retry",limit:10,now:new Date().toISOString()}))return reply.code(429).send({error:"ADMIN_RATE_LIMITED",retryAfterSeconds:60});
const params=z.object({id:z.string().min(1).max(128)}).safeParse(req.params);
const body=z.object({idempotencyKey:z.string().min(12).max(128)}).safeParse(req.body);
if(!params.success||!body.success)return reply.code(400).send({error:"INVALID_BROADCAST_RETRY"});
if(!options.adminBroadcastRetryPort)throw new Error("ADMIN_BROADCAST_SUPABASE_REPOSITORY_REQUIRED");
try{return await options.adminBroadcastRetryPort.retry("groups",params.data.id,actor.telegramId,body.data.idempotencyKey);}
catch(error){const code=error instanceof Error?error.message:"ADMIN_BROADCAST_RETRY_FAILED";if(code.includes("NO_FAILED_DELIVERIES"))return reply.code(409).send({error:"NO_FAILED_DELIVERIES"});if(code.includes("IDEMPOTENCY_KEY_REUSED"))return reply.code(409).send({error:"DUPLICATE_OR_IDEMPOTENCY_CONFLICT"});throw error;}
});
app.post("/v1/admin/user-broadcasts/:id/retry-failed",async(req,reply)=>{
const actor=await authorizeAdmin(req,reply,"moderation");if(!actor)return;
if(actor.adminRole!=="superadmin")return reply.code(403).send({error:"SUPERADMIN_REQUIRED"});
if(!options.adminAlliancePort)throw new Error("ADMIN_ALLIANCE_SUPABASE_REPOSITORY_REQUIRED");
if(!await options.adminAlliancePort.consumeRateLimit({telegramUserId:actor.telegramId,telegramGroupId:"global",action:"admin-user-broadcast-retry",limit:10,now:new Date().toISOString()}))return reply.code(429).send({error:"ADMIN_RATE_LIMITED",retryAfterSeconds:60});
const params=z.object({id:z.string().min(12).max(128)}).safeParse(req.params);
const body=z.object({idempotencyKey:z.string().min(12).max(128)}).safeParse(req.body);
if(!params.success||!body.success)return reply.code(400).send({error:"INVALID_BROADCAST_RETRY"});
if(!options.adminBroadcastRetryPort)throw new Error("ADMIN_BROADCAST_SUPABASE_REPOSITORY_REQUIRED");
try{return await options.adminBroadcastRetryPort.retry("users",params.data.id,actor.telegramId,body.data.idempotencyKey);}
catch(error){const code=error instanceof Error?error.message:"ADMIN_BROADCAST_RETRY_FAILED";if(code.includes("NO_FAILED_DELIVERIES"))return reply.code(409).send({error:"NO_FAILED_DELIVERIES"});if(code.includes("IDEMPOTENCY_KEY_REUSED"))return reply.code(409).send({error:"DUPLICATE_OR_IDEMPOTENCY_CONFLICT"});throw error;}
});
app.get("/v1/admin/group-broadcasts",async(req,reply)=>{
const actor=await authorizeAdmin(req,reply,"moderation");if(!actor)return;
if(actor.adminRole!=="superadmin")return reply.code(403).send({error:"SUPERADMIN_REQUIRED"});
const q=z.object({limit:z.coerce.number().int().min(1).max(100).default(40)}).safeParse(req.query);
if(!q.success)return reply.code(400).send({error:"INVALID_QUERY"});
if(!options.adminConsoleReadPort)throw new Error("ADMIN_CONSOLE_SUPABASE_REPOSITORY_REQUIRED");
return options.adminConsoleReadPort.broadcasts(q.data.limit);
});
app.get("/v1/admin/roles",async(req,reply)=>{const actor=await authorizeAdmin(req,reply);if(!actor)return;if(actor.adminRole!=="superadmin")return reply.code(403).send({error:"SUPERADMIN_REQUIRED"});if(!options.adminConfigurationPort)throw new Error("ADMIN_CONFIGURATION_SUPABASE_REPOSITORY_REQUIRED");return (await options.adminConfigurationPort.list()).roles;});
app.get("/v1/admin/settings",async(req,reply)=>{const actor=await authorizeAdmin(req,reply);if(!actor)return;if(actor.adminRole!=="superadmin")return reply.code(403).send({error:"SUPERADMIN_REQUIRED"});if(!options.adminConfigurationPort)throw new Error("ADMIN_CONFIGURATION_SUPABASE_REPOSITORY_REQUIRED");return (await options.adminConfigurationPort.list()).settings;});
app.get("/v1/admin/finance-summary",async(req,reply)=>{if(!await authorizeAdmin(req,reply,"economy"))return;const q=z.object({days:z.coerce.number().int().min(1).max(365).default(30)}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:"INVALID_QUERY"});if(!options.adminConsoleReadPort)throw new Error("ADMIN_CONSOLE_SUPABASE_REPOSITORY_REQUIRED");return options.adminConsoleReadPort.financeSummary(q.data.days);});
app.get("/v1/admin/:resource",async(req,reply)=>{const p=z.object({resource:z.enum(["players","clubs","users","groups","challenges","leagues","items","gift-codes","alliances","matches","alliance-seasons","wallet-ledger","group-ledger","audit","season-awards"])}).safeParse(req.params),q=querySchema.safeParse(req.query);if(!p.success||!q.success)return reply.code(400).send({error:"INVALID_QUERY"});const readPermission:Record<string,AdminPermission>={players:"players",clubs:"clubs",matches:"matches",leagues:"competitions","alliance-seasons":"groups",alliances:"groups",groups:"groups",challenges:"groups",users:"moderation",items:"gifts","gift-codes":"gifts","wallet-ledger":"economy","group-ledger":"economy",audit:"moderation","season-awards":"players"};if(!await authorizeAdmin(req,reply,readPermission[p.data.resource]))return;const {limit,q:term,season}=q.data;if(p.data.resource==="wallet-ledger"||p.data.resource==="group-ledger"||p.data.resource==="audit"){if(!options.adminConsoleReadPort)throw new Error("ADMIN_CONSOLE_SUPABASE_REPOSITORY_REQUIRED");return options.adminConsoleReadPort.ledgerEntries(p.data.resource,limit,term);}if(!options.adminConsoleReadPort)throw new Error("ADMIN_CONSOLE_SUPABASE_REPOSITORY_REQUIRED");return options.adminConsoleReadPort.resourceList(p.data.resource as AdminResourceListName,limit,term,season);
});
app.post("/v1/admin/actions",async(req,reply)=>{const actor=await authorizeAdmin(req,reply);if(!actor)return;const adminActionRateAllowed=options.adminAlliancePort?await options.adminAlliancePort.consumeRateLimit({telegramUserId:actor.telegramId,telegramGroupId:"global",action:"admin-actions",limit:20,now:new Date().toISOString()}):await consumeAllianceActionRateLimit({telegramUserId:actor.telegramId,telegramGroupId:"global",action:"admin-actions",limit:20});if(!adminActionRateAllowed)return reply.code(429).send({error:"ADMIN_RATE_LIMITED",retryAfterSeconds:60});const parsed=z.object({action:z.enum(["suspend-user","restore-user","suspend-group","restore-group","cancel-challenge","league-status","toggle-item","create-gift-code","toggle-gift-code","player-status","alliance-status","review-alliance-season","adjust-wallet","adjust-group-points","player-update","club-update","match-update","competition-status","item-update","season-status","create-item","set-admin-role","revoke-admin-role","set-game-setting","broadcast-users","broadcast-groups","set-season-player-award","remove-season-player-award","close-alliance-season","start-alliance-season"]),targetId:z.string().optional(),status:z.enum(["DRAFT","REGISTRATION","ACTIVE","COMPLETED","CANCELLED","RETIRED","SUSPENDED","DISSOLVED"]).optional(),active:z.boolean().optional(),amount:z.string().regex(/^-?\d{1,15}$/).optional(),asset:z.enum(["CASH","GOLD","HONOR"]).optional(),review:z.enum(["APPROVED","REJECTED","FLAGGED","PENDING"]).optional(),reason:z.string().max(500).optional(),idempotencyKey:z.string().min(12).max(128),code:z.string().trim().min(4).max(32).regex(/^[A-Za-z0-9_-]+$/).optional(),cashAmount:z.string().regex(/^\d{1,15}$/).optional(),goldAmount:z.string().regex(/^\d{1,15}$/).optional(),maxRedemptions:z.number().int().min(1).max(100000).optional(),perUserLimit:z.number().int().min(1).max(1000).optional(),expiresAt:z.string().datetime().optional(),firstName:z.string().trim().min(1).max(60).optional(),lastName:z.string().trim().min(1).max(60).optional(),age:z.number().int().min(15).max(55).optional(),overall:z.number().int().min(1).max(99).optional(),potential:z.number().int().min(1).max(99).optional(),wage:z.string().regex(/^\d{1,15}$/).optional(),contractDays:z.number().int().min(0).max(3650).optional(),fitness:z.number().int().min(0).max(100).optional(),morale:z.number().int().min(0).max(100).optional(),clubName:z.string().trim().min(2).max(60).optional(),level:z.number().int().min(1).max(100).optional(),reputation:z.number().int().min(0).max(1000000).optional(),stadiumLevel:z.number().int().min(1).max(100).optional(),academyLevel:z.number().int().min(0).max(100).optional(),trainingGroundLevel:z.number().int().min(1).max(100).optional(),ticketPrice:z.string().regex(/^\d{1,15}$/).optional(),scheduledAt:z.string().datetime().optional(),homeScore:z.number().int().min(0).max(99).optional(),awayScore:z.number().int().min(0).max(99).optional(),matchStatus:z.enum(["SCHEDULED","COMPLETED","CANCELLED"]).optional(),rewardType:z.enum(["WALLET","GROUP_POINTS"]).optional(),groupPoints:z.string().regex(/^\d{1,15}$/).optional(),itemName:z.string().trim().min(2).max(80).optional(),itemDescription:z.string().trim().min(2).max(500).optional(),itemCost:z.string().regex(/^\d{1,15}$/).optional(),itemSlug:z.string().trim().min(3).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),itemScope:z.enum(["PERSONAL","GROUP"]).optional(),seasonStatus:z.enum(["ACTIVE","COMPLETED","CANCELLED"]).optional(),adminTelegramId:z.string().regex(/^\d{1,20}$/).optional(),adminRole:z.enum(["football","economy","moderator"]).optional(),settingKey:z.string().trim().min(2).max(80).regex(/^[a-z0-9._-]+$/).optional(),settingValue:z.union([z.string(),z.number(),z.boolean(),z.record(z.unknown()),z.array(z.unknown())]).optional(),settingDescription:z.string().trim().max(300).optional(),broadcastMessage:z.string().trim().min(2).max(3000).optional(),durationDays:z.number().int().min(7).max(90).optional(),awardSeason:z.number().int().min(2020).max(2200).optional(),awardPlayerId:z.string().min(1).max(128).optional(),awardType:z.enum(["TOP_SCORER","TOP_ASSISTS","PLAYER_OF_SEASON","TEAM_OF_SEASON","FAIR_PLAY","MOST_IMPROVED"]).optional(),awardName:z.string().trim().min(2).max(80).optional(),awardReason:z.string().trim().max(500).optional()}).safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"INVALID_ADMIN_ACTION"});const x=parsed.data;if(["broadcast-users","broadcast-groups"].includes(x.action)&&!await consumeAllianceActionRateLimit({telegramUserId:actor.telegramId,telegramGroupId:"global",action:"admin-broadcasts",limit:2}))return reply.code(429).send({error:"ADMIN_BROADCAST_RATE_LIMITED",retryAfterSeconds:60});const actionPermission:Record<string,AdminPermission>={"suspend-user":"moderation","restore-user":"moderation","suspend-group":"moderation","restore-group":"moderation","cancel-challenge":"groups","league-status":"competitions","competition-status":"competitions","player-status":"players","player-update":"players","club-update":"clubs","match-update":"matches","alliance-status":"groups","review-alliance-season":"groups","season-status":"groups","adjust-wallet":"economy","adjust-group-points":"economy","create-gift-code":"gifts","toggle-gift-code":"gifts","toggle-item":"gifts","item-update":"gifts","create-item":"gifts","set-admin-role":"moderation","revoke-admin-role":"moderation","set-game-setting":"economy","broadcast-users":"moderation","broadcast-groups":"moderation","set-season-player-award":"players","remove-season-player-award":"players","close-alliance-season":"groups","start-alliance-season":"groups"};const requiredPermission=actionPermission[x.action];if(!requiredPermission||!ROLE_PERMISSIONS[actor.adminRole]?.includes(requiredPermission))return reply.code(403).send({error:"ADMIN_PERMISSION_REQUIRED",permission:requiredPermission??"unknown"});if(["set-admin-role","revoke-admin-role","set-game-setting","broadcast-users","broadcast-groups","close-alliance-season","start-alliance-season","review-alliance-season"].includes(x.action)&&actor.adminRole!=="superadmin")return reply.code(403).send({error:"SUPERADMIN_REQUIRED"});if(["adjust-wallet","adjust-group-points"].includes(x.action)&&options.adminFinancialAdjustmentPort){
try{
 const result=await options.adminFinancialAdjustmentPort.execute({
  action:x.action as "adjust-wallet"|"adjust-group-points",targetId:x.targetId??"",amount:x.amount!,actorTelegramId:actor.telegramId,
  idempotencyKey:x.idempotencyKey,reason:x.reason!,...(x.asset?{asset:x.asset}:{})
 });
 return {ok:true,targetType:result.targetType,targetId:result.targetId,replayed:result.replay,...(result.balance!==undefined?{balance:result.balance}:{}),...(result.points!==undefined?{points:result.points}:{})};
}catch(error){
 const code=error instanceof Error?error.message:"ADMIN_FINANCIAL_ADJUSTMENT_FAILED";
 if(code.includes("TARGET_NOT_FOUND"))return reply.code(404).send({error:code});
 if(["INSUFFICIENT_BALANCE","INSUFFICIENT_GROUP_POINTS","IDEMPOTENCY_CONFLICT","IDEMPOTENCY_KEY_REUSED"].some(v=>code.includes(v)))return reply.code(409).send({error:code});
 if(code.startsWith("INVALID_"))return reply.code(400).send({error:code});
 throw error;
}
}
if(["adjust-wallet","adjust-group-points"].includes(x.action)&&(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production")&&!options.adminFinancialAdjustmentPort)throw new Error("ADMIN_FINANCIAL_ADJUSTMENT_SUPABASE_REPOSITORY_REQUIRED");
let type="",id=x.targetId??"";let actionResult:Record<string,unknown>={};const seasonAlertRef:{value:{groupTelegramId:string;flags:Array<{code:string;group?:string;sharePercent?:number;groups?:Array<{group:string}>}>}|null}={value:null};
if(options.adminAlliancePort&&["review-alliance-season","close-alliance-season","start-alliance-season"].includes(x.action)){
try{
let rpcResult:unknown;
if(x.action==="start-alliance-season"){
if(!id)throw new Error("TARGET_REQUIRED");
rpcResult=await options.adminAlliancePort.adminStartAllianceSeason({actorTelegramId:actor.telegramId,allianceId:id,idempotencyKey:x.idempotencyKey,...(x.durationDays!==undefined?{durationDays:x.durationDays}:{}),...(x.reason?{reason:x.reason}:{})});
const result=rpcResult as {season?:{id?:string;number?:number;startsAt?:string;endsAt?:string};replayed?:boolean};
if(!result.season?.id)throw new Error("SUPABASE_ADMIN_ALLIANCE_INVALID_RESPONSE");
id=result.season.id;type="alliance-season";actionResult={seasonNumber:result.season.number,startsAt:result.season.startsAt,endsAt:result.season.endsAt,replayed:result.replayed??false};
}else if(x.action==="close-alliance-season"){
if(!id)throw new Error("TARGET_REQUIRED");
rpcResult=await options.adminAlliancePort.adminCloseAllianceSeason({actorTelegramId:actor.telegramId,seasonId:id,idempotencyKey:x.idempotencyKey,...(x.reason?{reason:x.reason}:{})});
const result=rpcResult as {reviewStatus?:string;replayed?:boolean;prize?:string;alertGroupTelegramId?:string;securityFlags?:Array<{code:string;group?:string;sharePercent?:number;groups?:Array<{group:string}>}>};
type="alliance-season";actionResult={reviewStatus:result.reviewStatus,replayed:result.replayed??false,...(result.prize!==undefined?{prize:result.prize}:{})};
if(!result.replayed&&result.reviewStatus==="FLAGGED"&&result.alertGroupTelegramId&&Array.isArray(result.securityFlags))seasonAlertRef.value={groupTelegramId:result.alertGroupTelegramId,flags:result.securityFlags};
}else{
if(!id||!x.review||!["APPROVED","REJECTED"].includes(x.review))throw new Error("INVALID_REVIEW");
rpcResult=await options.adminAlliancePort.adminReviewAllianceSeason({actorTelegramId:actor.telegramId,seasonId:id,decision:x.review==="APPROVED"?"APPROVE":"REJECT",idempotencyKey:x.idempotencyKey,...(x.reason?{reason:x.reason}:{})});
const result=rpcResult as {reviewStatus?:string;prize?:string;replayed?:boolean};
type="alliance-season";actionResult={reviewStatus:result.reviewStatus,prize:result.prize??"0",replayed:result.replayed??false};
}
const seasonAlert=seasonAlertRef.value;
if(seasonAlert&&process.env.TELEGRAM_BOT_TOKEN){
const alert=["هشدار امنیتی Football Empire","جایزه فصل اتحاد به دلیل الگوی مشکوک مسدود شد.",...seasonAlert.flags.map(flag=>flag.code==="SINGLE_MEMBER_CONCENTRATION"?"تمرکز امتیاز در "+(flag.group??"گروه نامشخص")+": "+(flag.sharePercent??0)+"%":"هم‌پوشانی امتیاز بین گروه‌ها: "+(flag.groups??[]).map(group=>group.group).join("، "))].join(String.fromCharCode(10));
try{await fetch("https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:seasonAlert.groupTelegramId,text:alert}),signal:AbortSignal.timeout(5000)});}catch(error){req.log.warn({error},"Could not deliver admin alliance season security alert");}
}
return{ok:true,targetType:type,targetId:id,...actionResult};
}catch(error){
const code=error instanceof Error?error.message:"ADMIN_ALLIANCE_RPC_FAILED";
if(["SEASON_NOT_ENDED","NO_ACTIVE_SEASON","SEASON_NOT_FLAGGED","ALLIANCE_FOUNDER_REQUIRED","SEASON_ALREADY_SETTLED","SEASON_ALREADY_ACTIVE","SEASON_REVIEW_REQUIRED","ALLIANCE_INACTIVE","DUPLICATE_OR_IDEMPOTENCY_CONFLICT","IDEMPOTENCY_CONFLICT"].includes(code))return reply.code(409).send({error:code});
if(["SEASON_NOT_FOUND","ALLIANCE_NOT_FOUND","ACCOUNT_NOT_FOUND"].includes(code))return reply.code(404).send({error:code});
if(code.startsWith("INVALID_"))return reply.code(400).send({error:code});
throw error;
}
}
if(["toggle-item","toggle-gift-code","create-item","item-update","create-gift-code"].includes(x.action)&&options.adminCatalogActionPort){
 try{
  if((["toggle-item","toggle-gift-code","item-update"].includes(x.action)&&!id)
   ||(["toggle-item","toggle-gift-code"].includes(x.action)&&x.active===undefined))return reply.code(400).send({error:"INVALID_ADMIN_CATALOG_ACTION"});
  const result=await options.adminCatalogActionPort.execute({
   action:x.action as import("./node-supabase-admin-catalog-actions.js").AdminCatalogAction,
   ...(id?{targetId:id}:{}),...(x.active!==undefined?{active:x.active}:{}),actorTelegramId:actor.telegramId,idempotencyKey:x.idempotencyKey,
   ...(x.itemSlug?{itemSlug:x.itemSlug}:{}),...(x.itemName?{itemName:x.itemName}:{}),...(x.itemDescription?{itemDescription:x.itemDescription}:{}),
   ...(x.itemCost!==undefined?{itemCost:x.itemCost}:{}),...(x.itemScope?{itemScope:x.itemScope}:{}),
   ...(x.code?{code:x.code}:{}),...(x.rewardType?{rewardType:x.rewardType}:{}),
   ...(x.cashAmount!==undefined?{cashAmount:x.cashAmount}:{}),...(x.goldAmount!==undefined?{goldAmount:x.goldAmount}:{}),
   ...(x.groupPoints!==undefined?{groupPoints:x.groupPoints}:{}),...(x.maxRedemptions!==undefined?{maxRedemptions:x.maxRedemptions}:{}),
   ...(x.perUserLimit!==undefined?{perUserLimit:x.perUserLimit}:{}),...(x.expiresAt?{expiresAt:x.expiresAt}:{})
  });
  return {ok:true,targetType:result.targetType,targetId:result.targetId,replayed:result.replay};
 }catch(error){
  const code=error instanceof Error?error.message:"ADMIN_CATALOG_ACTION_FAILED";
  if(code.includes("TARGET_NOT_FOUND"))return reply.code(404).send({error:code});
  if(code.includes("IDEMPOTENCY_KEY_REUSED")||code.includes("unique constraint")||code.includes("duplicate key"))return reply.code(409).send({error:code});
  if(code.startsWith("INVALID_"))return reply.code(400).send({error:code});
  throw error;
 }
}
if(["toggle-item","toggle-gift-code","create-item","item-update","create-gift-code"].includes(x.action)&&(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production")&&!options.adminCatalogActionPort)throw new Error("ADMIN_CATALOG_SUPABASE_REPOSITORY_REQUIRED");
if(["player-update","club-update","match-update","player-status","alliance-status","season-status"].includes(x.action)&&options.adminEntityUpdatePort){
 try{
  if(!id)return reply.code(400).send({error:"INVALID_ADMIN_ENTITY_ACTION"});
  const payload:Record<string,string|number>={};
  const fields:Record<string,string[]>={
   "player-update":["firstName","lastName","age","overall","potential","wage","contractDays","fitness","morale"],
   "club-update":["clubName","level","reputation","stadiumLevel","academyLevel","trainingGroundLevel","ticketPrice"],
   "match-update":["scheduledAt","homeScore","awayScore","matchStatus"],
  };
  if(x.action==="player-status")payload.status=x.status!;
  else if(x.action==="alliance-status")payload.status=x.status!;
  else if(x.action==="season-status")payload.status=x.seasonStatus!;
  else for(const key of fields[x.action]??[]){const value=(x as unknown as Record<string,unknown>)[key];if(value!==undefined)payload[key]=value as string|number;}
  const result=await options.adminEntityUpdatePort.execute({
   action:x.action as import("./node-supabase-admin-entity-update.js").AdminEntityUpdateAction,
   targetId:id,actorTelegramId:actor.telegramId,idempotencyKey:x.idempotencyKey,payload,
   ...(x.reason?{reason:x.reason}:{})
  });
  return {ok:true,targetType:result.targetType,targetId:result.targetId,replayed:result.replay};
 }catch(error){
  const code=error instanceof Error?error.message:"ADMIN_ENTITY_UPDATE_FAILED";
  if(code.includes("TARGET_NOT_FOUND"))return reply.code(404).send({error:code});
  if(["IDEMPOTENCY_KEY_REUSED","MATCH_ALREADY_STARTED","MATCH_COMPLETION_AUTOMATIC_ONLY","ALLIANCE_SEASON_ALREADY_SETTLED"].some(v=>code.includes(v)))return reply.code(409).send({error:code});
  if(code.startsWith("INVALID_"))return reply.code(400).send({error:code});
  throw error;
 }
}
if(["player-update","club-update","match-update","player-status","alliance-status","season-status"].includes(x.action)&&(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production")&&!options.adminEntityUpdatePort)throw new Error("ADMIN_ENTITY_UPDATE_SUPABASE_REPOSITORY_REQUIRED");
if(["suspend-user","restore-user","suspend-group","restore-group","cancel-challenge","league-status","competition-status"].includes(x.action)&&options.adminModerationActionPort){
try{
 const result=await options.adminModerationActionPort.execute({action:x.action as import("./node-supabase-admin-moderation-actions.js").AdminModerationAction,targetId:id,actorTelegramId:actor.telegramId,idempotencyKey:x.idempotencyKey,...(x.reason?{reason:x.reason}:{})});
 return {ok:true,targetType:result.targetType,targetId:result.targetId,replayed:result.replay};
}catch(error){
 const code=error instanceof Error?error.message:"ADMIN_MODERATION_ACTION_FAILED";
 if(code.includes("TARGET_NOT_FOUND"))return reply.code(404).send({error:code});
 if(["IDEMPOTENCY_KEY_REUSED","CHALLENGE_ALREADY_SETTLED","PYRAMID_LEAGUE_STATUS_MANAGED_AUTOMATICALLY"].some(v=>code.includes(v)))return reply.code(409).send({error:code});
 if(code.startsWith("INVALID_"))return reply.code(400).send({error:code});
 throw error;
}
}
if(["suspend-user","restore-user","suspend-group","restore-group","cancel-challenge","competition-status"].includes(x.action)&&(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production")&&!options.adminModerationActionPort)throw new Error("ADMIN_MODERATION_SUPABASE_REPOSITORY_REQUIRED");
if(["set-admin-role","revoke-admin-role","set-game-setting"].includes(x.action)&&options.adminConfigurationPort){
try{
 const result=await options.adminConfigurationPort.execute({
  action:x.action as "set-admin-role"|"revoke-admin-role"|"set-game-setting",
  actorTelegramId:actor.telegramId,idempotencyKey:x.idempotencyKey,
  ...(x.adminTelegramId?{adminTelegramId:x.adminTelegramId}:{}),
  ...(x.adminRole?{adminRole:x.adminRole}:{}),
  ...(x.settingKey?{settingKey:x.settingKey}:{}),
  ...(x.settingValue!==undefined?{settingValue:x.settingValue}:{}),
  ...(x.settingDescription!==undefined?{settingDescription:x.settingDescription}:{}),
 });
 return {ok:true,targetType:result.targetType,targetId:result.targetId,replayed:result.replay};
}catch(error){
 const message=error instanceof Error?error.message:"ADMIN_CONFIGURATION_ACTION_FAILED";
 if(message.includes("ADMIN_ROLE_NOT_FOUND"))return reply.code(404).send({error:message});
 if(["INVALID_ADMIN_ROLE","INVALID_SETTING","INVALID_ADMIN_CONFIGURATION_ACTION"].some(code=>message.includes(code)))return reply.code(400).send({error:message});
 if(message.includes("IDEMPOTENCY_KEY_REUSED"))return reply.code(409).send({error:message});
 throw error;
}
}
if((x.action==="set-admin-role"||x.action==="revoke-admin-role"||x.action==="set-game-setting")&&(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production")){
 throw new Error("ADMIN_CONFIGURATION_SUPABASE_REPOSITORY_REQUIRED");
}
if(["set-season-player-award","remove-season-player-award"].includes(x.action)&&options.adminSeasonAwardActionPort){
 try{
  const result=await options.adminSeasonAwardActionPort.execute({
   action:x.action as import("./node-supabase-admin-season-awards.js").AdminSeasonAwardAction,
   actorTelegramId:actor.telegramId,idempotencyKey:x.idempotencyKey,
   ...(x.action==="set-season-player-award"?{season:x.awardSeason,playerId:x.awardPlayerId,awardType:x.awardType,awardName:x.awardName,...(x.awardReason!==undefined?{reason:x.awardReason}:{})}:{targetId:id,...(x.reason!==undefined?{reason:x.reason}:{})})
  });
  return {ok:true,targetType:result.targetType,targetId:result.targetId,replayed:result.replay};
 }catch(error){
  const code=error instanceof Error?error.message:"ADMIN_SEASON_AWARD_ACTION_FAILED";
  if(code.includes("TARGET_NOT_FOUND"))return reply.code(404).send({error:code});
  if(code.includes("IDEMPOTENCY_KEY_REUSED"))return reply.code(409).send({error:code});
  if(code.startsWith("INVALID_"))return reply.code(400).send({error:code});
  throw error;
 }
}
if(["set-season-player-award","remove-season-player-award"].includes(x.action)&&(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production")&&!options.adminSeasonAwardActionPort)throw new Error("ADMIN_SEASON_AWARD_SUPABASE_REPOSITORY_REQUIRED");
if(["broadcast-users","broadcast-groups"].includes(x.action)&&options.adminBroadcastCreatePort){
 try{
  if(!x.broadcastMessage)return reply.code(400).send({error:"INVALID_ADMIN_BROADCAST"});
  const result=await options.adminBroadcastCreatePort.create(x.action==="broadcast-users"?"users":"groups",x.broadcastMessage,actor.telegramId,x.idempotencyKey);
  return {ok:true,targetType:result.kind==="users"?"broadcast":"group-broadcast",targetId:result.targetId,replayed:result.replay,recipients:result.recipients};
 }catch(error){
  const code=error instanceof Error?error.message:"ADMIN_BROADCAST_CREATE_FAILED";
  if(code.includes("NO_BROADCAST_RECIPIENTS"))return reply.code(409).send({error:code});
  if(code.includes("IDEMPOTENCY_KEY_REUSED"))return reply.code(409).send({error:code});
  if(code.startsWith("INVALID_"))return reply.code(400).send({error:code});
  throw error;
 }
}
if(["broadcast-users","broadcast-groups"].includes(x.action)&&(process.env.NODE_ENV==="production"||process.env.ENVIRONMENT==="production")&&!options.adminBroadcastCreatePort)throw new Error("ADMIN_BROADCAST_CREATE_SUPABASE_REPOSITORY_REQUIRED");
try{await prisma.$transaction(async tx=>{switch(x.action){
case"suspend-user":case"restore-user":if(!id)throw new Error("TARGET_REQUIRED");type="user";await tx.user.update({where:{id},data:{isSuspended:x.action==="suspend-user",suspendedAt:x.action==="suspend-user"?new Date():null,suspensionReason:x.action==="suspend-user"?(x.reason??"Administrative action"):null}});break;
case"suspend-group":case"restore-group":if(!id)throw new Error("TARGET_REQUIRED");type="group";await tx.telegramGroup.update({where:{id},data:{isSuspended:x.action==="suspend-group",isActive:false,suspendedAt:x.action==="suspend-group"?new Date():null,suspensionReason:x.action==="suspend-group"?(x.reason??"Administrative action"):null}});break;
case"cancel-challenge":{if(!id)throw new Error("TARGET_REQUIRED");type="challenge";const challenge=await tx.groupChallenge.findUnique({where:{id},include:{group:true}});if(!challenge)throw new Error("TARGET_NOT_FOUND");if(challenge.status==="OPEN"){await tx.groupChallenge.update({where:{id},data:{status:"CANCELLED"}});if(challenge.rewardPoints>0n){await tx.telegramGroup.update({where:{id:challenge.groupId},data:{points:{increment:challenge.rewardPoints}}});await tx.groupPointLedger.create({data:{idempotencyKey:"challenge:"+id+":refund",groupId:challenge.groupId,userId:null,amount:challenge.rewardPoints,source:"CHALLENGE_REWARD",description:"Admin cancellation refund"}});}}else if(challenge.status!=="CANCELLED")throw new Error("CHALLENGE_ALREADY_SETTLED");break;}
case"league-status":case"competition-status":{if(!id||!x.status||x.status!=="CANCELLED")throw new Error("INVALID_STATUS");if(await tx.pyramidLeague.findUnique({where:{competitionId:id},select:{id:true}}))throw new Error("PYRAMID_LEAGUE_STATUS_MANAGED_AUTOMATICALLY");assertManualCompetitionStatus(x.status);type="competition";await tx.competition.update({where:{id},data:{status:"CANCELLED"}});break;}
case"toggle-item":if(!id||x.active===undefined)throw new Error("INVALID_ACTION");type="item";await tx.groupRewardItem.update({where:{id},data:{active:x.active}});break;
case"toggle-gift-code":if(!id||x.active===undefined)throw new Error("INVALID_ACTION");type="gift-code";await tx.giftCode.update({where:{id},data:{active:x.active}});break;
case"player-update":{if(!id)throw new Error("TARGET_REQUIRED");const data={...(x.firstName?{firstName:x.firstName}:{}),...(x.lastName?{lastName:x.lastName}:{}),...(x.age!==undefined?{age:x.age}:{}),...(x.overall!==undefined?{overall:x.overall}:{}),...(x.potential!==undefined?{potential:x.potential}:{}),...(x.wage!==undefined?{wage:BigInt(x.wage)}:{}),...(x.contractDays!==undefined?{contractDays:x.contractDays}:{}),...(x.fitness!==undefined?{fitness:x.fitness}:{}),...(x.morale!==undefined?{morale:x.morale}:{})};if(!Object.keys(data).length)throw new Error("INVALID_ADJUSTMENT");type="player";await tx.player.update({where:{id},data});break;}
case"club-update":{if(!id)throw new Error("TARGET_REQUIRED");const data={...(x.clubName?{name:x.clubName}:{}),...(x.level!==undefined?{level:x.level}:{}),...(x.reputation!==undefined?{reputation:x.reputation}:{}),...(x.stadiumLevel!==undefined?{stadiumLevel:x.stadiumLevel}:{}),...(x.academyLevel!==undefined?{academyLevel:x.academyLevel}:{}),...(x.trainingGroundLevel!==undefined?{trainingGroundLevel:x.trainingGroundLevel}:{}),...(x.ticketPrice!==undefined?{ticketPrice:BigInt(x.ticketPrice)}:{})};if(!Object.keys(data).length)throw new Error("INVALID_ADJUSTMENT");type="club";await tx.club.update({where:{id},data});break;}
case"match-update":{if(!id)throw new Error("TARGET_REQUIRED");const current=await tx.footballMatch.findUnique({where:{id},select:{status:true}});if(!current)throw new Error("TARGET_NOT_FOUND");if(current.status==="COMPLETED"||x.matchStatus==="COMPLETED")throw new Error("MATCH_COMPLETION_AUTOMATIC_ONLY");if(current.status==="IN_PROGRESS")throw new Error("MATCH_ALREADY_STARTED");const data={...(x.scheduledAt?{scheduledAt:new Date(x.scheduledAt)}:{}),...(x.homeScore!==undefined?{homeScore:x.homeScore}:{}),...(x.awayScore!==undefined?{awayScore:x.awayScore}:{}),...(x.matchStatus?{status:x.matchStatus}:{})};if(!Object.keys(data).length)throw new Error("INVALID_ADJUSTMENT");type="match";await tx.footballMatch.update({where:{id},data});break;}

case"start-alliance-season":{if(!id)throw new Error("TARGET_REQUIRED");type="alliance-season";const started=await adminStartAllianceSeasonInTransaction(tx,{telegramUserId:actor.telegramId,allianceId:id,...(x.durationDays!==undefined?{durationDays:x.durationDays}:{})});id=started.season.id;actionResult={seasonNumber:started.season.number,startsAt:started.season.startsAt.toISOString(),endsAt:started.season.endsAt.toISOString()};break;}case"close-alliance-season":{if(!id)throw new Error("TARGET_REQUIRED");type="alliance-season";const closed=await adminCloseAllianceSeasonInTransaction(tx,{telegramUserId:actor.telegramId,seasonId:id});actionResult={reviewStatus:closed.reviewStatus,replayed:closed.replayed,...("prize"in closed?{prize:closed.prize}:{} )};if(!closed.replayed&&closed.reviewStatus==="FLAGGED"&&"alertGroupTelegramId"in closed&&Array.isArray(closed.securityFlags))seasonAlertRef.value={groupTelegramId:closed.alertGroupTelegramId as string,flags:closed.securityFlags as Array<{code:string;group?:string;sharePercent?:number;groups?:Array<{group:string}>}>};break;}case"season-status":{if(!id||!x.seasonStatus)throw new Error("INVALID_STATUS");if(x.seasonStatus==="COMPLETED")throw new Error("ALLIANCE_SEASON_COMPLETION_AUTOMATIC_ONLY");const current=await tx.allianceSeason.findUnique({where:{id},select:{status:true}});if(!current)throw new Error("TARGET_NOT_FOUND");if(current.status==="COMPLETED")throw new Error("ALLIANCE_SEASON_ALREADY_SETTLED");type="alliance-season";await tx.allianceSeason.update({where:{id},data:{status:x.seasonStatus}});break;}
case"item-update":{if(!id)throw new Error("TARGET_REQUIRED");const data={...(x.itemName?{name:x.itemName}:{}),...(x.itemDescription?{description:x.itemDescription}:{}),...(x.itemCost!==undefined?{cost:BigInt(x.itemCost)}:{})};if(!Object.keys(data).length)throw new Error("INVALID_ADJUSTMENT");type="item";await tx.groupRewardItem.update({where:{id},data});break;}
case"player-status":if(!id||!x.status||!["ACTIVE","RETIRED"].includes(x.status))throw new Error("INVALID_STATUS");type="player";await tx.player.update({where:{id},data:{status:x.status as "ACTIVE"|"RETIRED",...(x.status==="RETIRED"?{lineupSlot:null}:{})}});break;
case"alliance-status":if(!id||!x.status||!["ACTIVE","SUSPENDED","DISSOLVED"].includes(x.status))throw new Error("INVALID_STATUS");type="alliance";await tx.alliance.update({where:{id},data:{status:x.status as "ACTIVE"|"SUSPENDED"|"DISSOLVED"}});break;
case"review-alliance-season":{if(!id||!x.review||!["APPROVED","REJECTED"].includes(x.review))throw new Error("INVALID_REVIEW");type="alliance-season";const reviewed=await adminReviewAllianceSeasonInTransaction(tx,{telegramUserId:actor.telegramId,telegramUserDbId:actor.id,seasonId:id,decision:x.review==="APPROVED"?"APPROVE":"REJECT"});actionResult={reviewStatus:reviewed.season.reviewStatus,prize:reviewed.prize,replayed:reviewed.replayed};break;}
case"adjust-wallet":{if(!id||!x.amount||!x.asset||!x.reason)throw new Error("INVALID_ADJUSTMENT");const amount=BigInt(x.amount);if(amount===0n)throw new Error("INVALID_ADJUSTMENT");type="wallet";const user=await tx.user.findUnique({where:{id},select:{id:true}});if(!user)throw new Error("TARGET_NOT_FOUND");const key="admin-wallet:"+x.idempotencyKey;const prior=await tx.ledgerTransaction.findUnique({where:{idempotencyKey:key}});if(prior)throw new Error("DUPLICATE_OR_IDEMPOTENCY_CONFLICT");if(amount<0n){const debit=await tx.wallet.updateMany({where:{userId:id,asset:x.asset,balance:{gte:-amount}},data:{balance:{decrement:-amount},version:{increment:1}}});if(!debit.count)throw new Error("INSUFFICIENT_BALANCE");}else await tx.wallet.upsert({where:{userId_asset:{userId:id,asset:x.asset}},create:{userId:id,asset:x.asset,balance:amount},update:{balance:{increment:amount},version:{increment:1}}});await tx.ledgerTransaction.create({data:{idempotencyKey:key,userId:id,asset:x.asset,direction:amount>0n?"CREDIT":"DEBIT",amount:amount>0n?amount:-amount,reason:"ADMIN_ADJUSTMENT: "+x.reason,referenceType:"ADMIN",referenceId:x.idempotencyKey}});break;}
case"adjust-group-points":{if(!id||!x.amount||!x.reason)throw new Error("INVALID_ADJUSTMENT");const amount=BigInt(x.amount);if(amount===0n)throw new Error("INVALID_ADJUSTMENT");type="group-points";const key="admin-group-points:"+x.idempotencyKey;const prior=await tx.groupPointLedger.findUnique({where:{idempotencyKey:key}});if(prior)throw new Error("DUPLICATE_OR_IDEMPOTENCY_CONFLICT");if(amount<0n){const debit=await tx.telegramGroup.updateMany({where:{id,points:{gte:-amount}},data:{points:{decrement:-amount}}});if(!debit.count)throw new Error("INSUFFICIENT_GROUP_POINTS");}else await tx.telegramGroup.update({where:{id},data:{points:{increment:amount}}});await tx.groupPointLedger.create({data:{idempotencyKey:key,groupId:id,userId:null,amount,source:"ADMIN_ADJUSTMENT",description:x.reason}});break;}
case"set-season-player-award":{if(x.awardSeason===undefined||!x.awardPlayerId||!x.awardType||!x.awardName)throw new Error("INVALID_SEASON_AWARD");const player=await tx.player.findUnique({where:{id:x.awardPlayerId},select:{id:true}});if(!player)throw new Error("TARGET_NOT_FOUND");type="season-player-award";const award=await tx.seasonPlayerAward.upsert({where:{season_playerId_awardType:{season:x.awardSeason,playerId:x.awardPlayerId,awardType:x.awardType}},create:{season:x.awardSeason,playerId:x.awardPlayerId,awardType:x.awardType,awardName:x.awardName,reason:x.awardReason??null,createdByTelegramId:actor.telegramId,updatedByTelegramId:actor.telegramId},update:{awardName:x.awardName,reason:x.awardReason??null,updatedByTelegramId:actor.telegramId}});id=award.id;break;}case"remove-season-player-award":{if(!id)throw new Error("TARGET_REQUIRED");type="season-player-award";await tx.seasonPlayerAward.delete({where:{id}});break;}case"broadcast-users":{if(!x.broadcastMessage)throw new Error("INVALID_BROADCAST");type="broadcast";id=x.idempotencyKey;const users=await tx.user.findMany({where:{isSuspended:false},select:{id:true}});if(!users.length)throw new Error("NO_BROADCAST_RECIPIENTS");await tx.leagueNotice.createMany({data:users.map(user=>({userId:user.id,kind:"ADMIN_BROADCAST",title:"پیام مدیریت Football Empire",body:x.broadcastMessage!,referenceId:x.idempotencyKey}))});break;}case"broadcast-groups":{if(!x.broadcastMessage)throw new Error("INVALID_BROADCAST");type="group-broadcast";const groups=await tx.telegramGroup.findMany({where:{isActive:true,isSuspended:false},select:{telegramId:true,title:true}});if(!groups.length)throw new Error("NO_BROADCAST_RECIPIENTS");const broadcast=await tx.adminGroupBroadcast.create({data:{idempotencyKey:x.idempotencyKey,message:x.broadcastMessage,createdByTelegramId:actor.telegramId,deliveries:{createMany:{data:groups.map(group=>({telegramGroupId:group.telegramId,groupTitle:group.title}))}}},select:{id:true}});id=broadcast.id;break;}case"set-admin-role":{if(!x.adminTelegramId||!x.adminRole)throw new Error("INVALID_ADMIN_ROLE");type="admin-role";const row=await tx.adminRoleAssignment.upsert({where:{telegramId:x.adminTelegramId},create:{telegramId:x.adminTelegramId,role:x.adminRole,active:true,createdByTelegramId:actor.telegramId,updatedByTelegramId:actor.telegramId},update:{role:x.adminRole,active:true,updatedByTelegramId:actor.telegramId}});id=row.id;break;}case"revoke-admin-role":{if(!x.adminTelegramId)throw new Error("INVALID_ADMIN_ROLE");type="admin-role";const row=await tx.adminRoleAssignment.update({where:{telegramId:x.adminTelegramId},data:{active:false,updatedByTelegramId:actor.telegramId}});id=row.id;break;}case"set-game-setting":{if(!x.settingKey||x.settingValue===undefined)throw new Error("INVALID_SETTING");const settingLimits:Record<string,{min:number;max:number}>={"groups.minimumMembers":{min:5,max:1000},"groups.dailyActivityPoints":{min:0,max:1000},"groups.dailyPointCap":{min:0,max:100000},"groups.challengeJoinPoints":{min:0,max:1000},"groups.challengeCreatePoints":{min:0,max:1000},"groups.leagueJoinPoints":{min:0,max:1000},"groups.leagueCreatePoints":{min:0,max:1000},"groups.matchPlayedPoints":{min:0,max:1000},"alliances.defaultSeasonDurationDays":{min:7,max:90},"economy.starterCash":{min:0,max:1000000000},"economy.starterGold":{min:0,max:1000000}};const limits=Object.prototype.hasOwnProperty.call(settingLimits,x.settingKey)?settingLimits[x.settingKey]:undefined;if(!limits||typeof x.settingValue!=="number"||!Number.isSafeInteger(x.settingValue)||x.settingValue<limits.min||x.settingValue>limits.max)throw new Error("INVALID_SETTING");type="game-setting";const row=await tx.gameSetting.upsert({where:{key:x.settingKey},create:{key:x.settingKey,value:x.settingValue as import("@prisma/client").Prisma.InputJsonValue,description:x.settingDescription??null,updatedByTelegramId:actor.telegramId},update:{value:x.settingValue as import("@prisma/client").Prisma.InputJsonValue,description:x.settingDescription??null,updatedByTelegramId:actor.telegramId}});id=row.id;break;}case"create-item":{if(!x.itemSlug||!x.itemName||!x.itemDescription||x.itemCost===undefined||!x.itemScope)throw new Error("INVALID_ITEM");type="item";const item=await tx.groupRewardItem.create({data:{slug:x.itemSlug,name:x.itemName,description:x.itemDescription,cost:BigInt(x.itemCost),scope:x.itemScope}});id=item.id;break;}
case"create-gift-code":if(!x.code||!x.maxRedemptions||((x.rewardType??"WALLET")==="GROUP_POINTS"?BigInt(x.groupPoints??"0")<=0n:(BigInt(x.cashAmount??"0")+BigInt(x.goldAmount??"0")<=0n)))throw new Error("INVALID_GIFT_CODE");type="gift-code";const gift=await tx.giftCode.create({data:{code:x.code.toUpperCase(),rewardType:x.rewardType??"WALLET",cashAmount:BigInt(x.cashAmount??"0"),goldAmount:BigInt(x.goldAmount??"0"),groupPoints:BigInt(x.groupPoints??"0"),maxRedemptions:x.maxRedemptions,perUserLimit:x.perUserLimit??1,expiresAt:x.expiresAt?new Date(x.expiresAt):null,createdByTelegramId:actor.telegramId}});id=gift.id;break;
}await tx.adminAuditLog.create({data:{actorTelegramId:actor.telegramId,action:x.action,targetType:type,targetId:id,reason:x.reason??null,idempotencyKey:x.idempotencyKey,metadata:{status:x.status??null,active:x.active??null,amount:x.amount??null,asset:x.asset??null,review:x.review??null,reason:x.reason??null,awardSeason:x.awardSeason??null,awardType:x.awardType??null,awardName:x.awardName??null}}});});
const seasonAlert = seasonAlertRef.value;
if(seasonAlert&&process.env.TELEGRAM_BOT_TOKEN){
const alert=["هشدار امنیتی Football Empire","جایزه فصل اتحاد به دلیل الگوی مشکوک مسدود شد.",...seasonAlert.flags.map(flag=>flag.code==="SINGLE_MEMBER_CONCENTRATION"?"تمرکز امتیاز در "+(flag.group??"گروه نامشخص")+": "+(flag.sharePercent??0)+"%":"هم‌پوشانی امتیاز بین گروه‌ها: "+(flag.groups??[]).map(group=>group.group).join("، "))].join(String.fromCharCode(10));
try{await fetch("https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:seasonAlert.groupTelegramId,text:alert}),signal:AbortSignal.timeout(5000)});}catch(error){req.log.warn({error},"Could not deliver admin alliance season security alert");}
}
return{ok:true,targetType:type,targetId:id,...actionResult};
}catch(e){if(e instanceof Error&&["SEASON_NOT_ENDED","NO_ACTIVE_SEASON","SEASON_NOT_FLAGGED","ALLIANCE_FOUNDER_REQUIRED","SEASON_ALREADY_SETTLED","ALLIANCE_SEASON_ALREADY_SETTLED","ALLIANCE_SEASON_COMPLETION_AUTOMATIC_ONLY","COMPETITION_COMPLETION_AUTOMATIC_ONLY","MATCH_COMPLETION_AUTOMATIC_ONLY","MATCH_ALREADY_STARTED","ALLIANCE_INACTIVE","SEASON_ALREADY_ACTIVE","SEASON_REVIEW_REQUIRED"].includes(e.message))return reply.code(409).send({error:e.message});if(typeof e==="object"&&e!==null&&"code"in e&&e.code==="P2002")return reply.code(409).send({error:"DUPLICATE_OR_IDEMPOTENCY_CONFLICT"});if(typeof e==="object"&&e!==null&&"code"in e&&e.code==="P2025")return reply.code(404).send({error:"TARGET_NOT_FOUND"});if(e instanceof Error&&(e.message==="TARGET_REQUIRED"||e.message.startsWith("INVALID")||e.message==="CHALLENGE_ALREADY_SETTLED"||e.message==="TARGET_NOT_FOUND"||e.message==="INVALID_REVIEW"||e.message==="INVALID_ADJUSTMENT"||e.message==="INSUFFICIENT_BALANCE"||e.message==="INSUFFICIENT_GROUP_POINTS"||e.message==="NO_BROADCAST_RECIPIENTS"||e.message==="INVALID_SEASON_AWARD"||e.message==="PYRAMID_COMPLETION_AUTOMATIC_ONLY"||e.message==="COMPETITION_COMPLETION_AUTOMATIC_ONLY"||e.message==="ALLIANCE_SEASON_COMPLETION_AUTOMATIC_ONLY"||e.message==="ALLIANCE_SEASON_ALREADY_SETTLED"||e.message==="SEASON_NOT_ENDED"||e.message==="ALLIANCE_INACTIVE"||e.message==="SEASON_ALREADY_ACTIVE"||e.message==="SEASON_REVIEW_REQUIRED"||e.message==="ALLIANCE_NOT_FOUND"||e.message==="INVALID_SEASON_DURATION"||e.message==="NO_ACTIVE_SEASON"||e.message==="SEASON_NOT_FLAGGED"||e.message==="ALLIANCE_FOUNDER_REQUIRED"||e.message==="SEASON_ALREADY_SETTLED"||e.message==="MATCH_COMPLETION_AUTOMATIC_ONLY"||e.message==="MATCH_ALREADY_STARTED"))return reply.code(400).send({error:e.message});throw e;}});
}
