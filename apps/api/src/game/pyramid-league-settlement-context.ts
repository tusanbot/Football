import { AsyncLocalStorage } from "node:async_hooks";
export interface FriendlyChallengeRecord {
 id:string; token:string; status:string; expiresAt:string; creatorUserId:string; creatorClubId:string;
 groupId:string|null; idempotencyKey:string|null; chargeAsset:"FREE"|"GOLD"|"PURCHASED";
 goldCost:string; createdAt:string; matchId:string|null;
}
export interface FriendlyChallengeCreateResult {
 challenge:FriendlyChallengeRecord; asset:"FREE"|"GOLD"|"PURCHASED"; goldCost:string;
 remaining:{free:number;gold:number;purchased:number}; replayed:boolean;
}
export interface FriendlyChallengeMatch { id:string; homeClubId:string; awayClubId:string; [key:string]:unknown; }
export interface FriendlyChallengeAcceptResult { match:FriendlyChallengeMatch; replayed:boolean; }
export interface FriendlyChallengeInfo {
 id:string; token:string; status:string; expiresAt:string;
 creatorClub:{name:string;level:number;reputation:number}; creatorTelegramId:string;
 groupTitle:string|null; groupTelegramId:string|null;
}
export interface ChallengeDailyUsageResult { id:string; userId:string; usageDate:string; freeUsed:number; goldUsed:number; purchasedCredits:number; }
export interface PyramidLeagueSettlementPort {
 apply(userId:string,tier:number,now:string):Promise<Record<string,unknown>>;
 finalize(competitionId:string,now:string):Promise<{processed:boolean;replayed?:boolean;leagueId?:string;champion?:string;runnerUp?:string;thirdPlace?:string}>;
 respond(userId:string,offerId:string,accept:boolean,now:string):Promise<Record<string,unknown>>;
 processDue(now:string,limit:number):Promise<{completedLeagues:number;processed:number;accepted:number;failed:number}>;
 listLeagues(userId:string):Promise<Record<string,unknown>>;
 getClubHistory(userId:string):Promise<Record<string,unknown>>;
 getLeagueDetails(userId:string,leagueId:string):Promise<Record<string,unknown>>;
 listNotices(userId:string):Promise<{notices:unknown[]}>;
 markNoticesRead(userId:string,now:string):Promise<{markedRead:number}>;
 claimNotices(limit:number,now:string):Promise<{notices:unknown[]}>;
 completeNotice(id:string,claimToken:string,now:string):Promise<{completed:boolean}>;
 failNotice(id:string,claimToken:string,error:string,now:string):Promise<{owned:boolean;rescheduled?:boolean;attempts?:number}>;
 createFriendlyChallenge(userId:string,goldCost:string,now:string,groupTelegramId:string|null,idempotencyKey:string):Promise<FriendlyChallengeCreateResult>;
 acceptFriendlyChallenge(userId:string,token:string,now:string):Promise<FriendlyChallengeAcceptResult>;
 getFriendlyChallengeInfo(token:string,now:string):Promise<FriendlyChallengeInfo>;
 grantPurchasedChallengeCredits(userId:string,quantity:number,now:string):Promise<ChallengeDailyUsageResult>;
}
const scope=new AsyncLocalStorage<PyramidLeagueSettlementPort>();
export function withPyramidLeagueSettlementPort<T>(port:PyramidLeagueSettlementPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
export function getPyramidLeagueSettlementPort():PyramidLeagueSettlementPort|undefined{
 const port=scope.getStore();
 if(!port&&(process.env.NODE_ENV==="production" || process.env.ENVIRONMENT==="production")){
  throw new Error("PYRAMID_LEAGUE_SUPABASE_REPOSITORY_REQUIRED");
 }
 return port;
}
