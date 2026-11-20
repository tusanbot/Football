import type { PyramidLeagueSettlementPort } from "./pyramid-league-settlement-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";
export class SupabasePyramidLeagueSettlementRepository implements PyramidLeagueSettlementPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async apply(userId:string,tier:number,now:string){
  const result=await this.client.rpc<Record<string,unknown>>("apply_pyramid_league_http",{
   p_user_id:userId,p_tier:tier,p_now:now
  });
  if(!result||result.applied!==true||typeof result.replayed!=="boolean"
   ||typeof result.status!=="string"||typeof result.waitingTeams!=="number"){
   throw new Error("SUPABASE_PYRAMID_APPLICATION_INVALID_RESPONSE");
  }
  if(result.status==="ASSIGNED"&&(typeof result.leagueId!=="string"||typeof result.competitionId!=="string"
   ||typeof result.fixturesCreated!=="number"||typeof result.teams!=="number")){
   throw new Error("SUPABASE_PYRAMID_APPLICATION_INVALID_ASSIGNMENT");
  }
  return result;
 }
 async finalize(competitionId:string,now:string){
  const result=await this.client.rpc<Awaited<ReturnType<PyramidLeagueSettlementPort["finalize"]>>>("finalize_pyramid_league_http",{p_competition_id:competitionId,p_now:now});
  if(!result||typeof result.processed!=="boolean")throw new Error("SUPABASE_PYRAMID_FINALIZATION_REJECTED");
  return result;
 }
 async respond(userId:string,offerId:string,accept:boolean,now:string){
  const result=await this.client.rpc<Record<string,unknown>>("respond_promotion_offer_http",{p_user_id:userId,p_offer_id:offerId,p_accept:accept,p_now:now});
  if(!result||typeof result.accepted!=="boolean"||typeof result.replayed!=="boolean")throw new Error("SUPABASE_PROMOTION_RESPONSE_REJECTED");
  return result;
 }
 async processDue(now:string,limit:number){
  const result=await this.client.rpc<{completedLeagues:number;processed:number;accepted:number}>("process_due_pyramid_work_http",{p_now:now,p_limit:limit});
  if(!result||typeof result.completedLeagues!=="number"||typeof result.processed!=="number"||typeof result.accepted!=="number")throw new Error("SUPABASE_PYRAMID_BATCH_REJECTED");
  return result;
 }
 async listLeagues(userId:string){
  const result=await this.client.rpc<Record<string,unknown>>("get_pyramid_league_overview_http",{p_user_id:userId});
  if(!result||typeof result.season!=="number"||!Array.isArray(result.tiers)||!Array.isArray(result.history)||!Array.isArray(result.promotionOffers))throw new Error("SUPABASE_PYRAMID_OVERVIEW_INVALID_RESPONSE");
  return result;
 }
 async getClubHistory(userId:string){
  const result=await this.client.rpc<Record<string,unknown>>("get_pyramid_league_history_http",{p_user_id:userId});
  if(!result||!result.club||!result.stats||!Array.isArray(result.tiers)||!Array.isArray(result.movements)||!Array.isArray(result.leagues))throw new Error("SUPABASE_PYRAMID_HISTORY_INVALID_RESPONSE");
  return result;
 }

 async getLeagueDetails(userId:string,leagueId:string){
  const result=await this.client.rpc<Record<string,unknown>>("get_pyramid_league_details_http",{p_user_id:userId,p_league_id:leagueId});
  if(!result||!result.league||!Array.isArray(result.standings)||!Array.isArray(result.matches)||!Array.isArray(result.topScorers)||!Array.isArray(result.topAssists)||!Array.isArray(result.awards)||!Array.isArray(result.nextRoundMatches))throw new Error("SUPABASE_PYRAMID_DETAILS_INVALID_RESPONSE");
  return result;
 }

 async listNotices(userId:string){
  const result=await this.client.rpc<{notices:unknown[]}>("list_pyramid_league_notices_http",{p_user_id:userId});
  if(!result||!Array.isArray(result.notices))throw new Error("SUPABASE_PYRAMID_NOTICES_INVALID_RESPONSE"); return result;
 }
 async markNoticesRead(userId:string,now:string){
  const result=await this.client.rpc<{markedRead:number}>("mark_pyramid_league_notices_read_http",{p_user_id:userId,p_now:now});
  if(!result||typeof result.markedRead!=="number")throw new Error("SUPABASE_PYRAMID_NOTICES_READ_INVALID_RESPONSE"); return result;
 }
 async claimNotices(limit:number,now:string){
  const result=await this.client.rpc<{notices:unknown[]}>("claim_pyramid_league_notices_http",{p_limit:limit,p_now:now});
  if(!result||!Array.isArray(result.notices))throw new Error("SUPABASE_PYRAMID_NOTICES_CLAIM_INVALID_RESPONSE"); return result;
 }
 async completeNotice(id:string,claimToken:string,now:string){
  const result=await this.client.rpc<{completed:boolean}>("complete_pyramid_league_notice_http",{p_id:id,p_claim_token:claimToken,p_now:now});
  if(!result||typeof result.completed!=="boolean")throw new Error("SUPABASE_PYRAMID_NOTICE_COMPLETE_INVALID_RESPONSE"); return result;
 }
 async failNotice(id:string,claimToken:string,error:string,now:string){
  const result=await this.client.rpc<{owned:boolean;rescheduled?:boolean;attempts?:number}>("fail_pyramid_league_notice_http",{p_id:id,p_claim_token:claimToken,p_error:error,p_now:now});
  if(!result||typeof result.owned!=="boolean")throw new Error("SUPABASE_PYRAMID_NOTICE_FAIL_INVALID_RESPONSE"); return result;
 }

 async createFriendlyChallenge(userId:string,goldCost:string,now:string,groupTelegramId:string|null,idempotencyKey:string){
  const result=await this.client.rpc<Awaited<ReturnType<PyramidLeagueSettlementPort["createFriendlyChallenge"]>>>("create_friendly_challenge_http",{p_user_id:userId,p_gold_cost:goldCost,p_now:now,p_group_telegram_id:groupTelegramId,p_idempotency_key:idempotencyKey});
  if(!result||!result.challenge||typeof result.asset!=="string"||typeof result.goldCost!=="string"||!result.remaining||typeof result.replayed!=="boolean")throw new Error(typeof result?.error==="string"?result.error:"SUPABASE_FRIENDLY_CHALLENGE_CREATE_INVALID_RESPONSE"); return result;
 }
 async acceptFriendlyChallenge(userId:string,token:string,now:string){
  const result=await this.client.rpc<Awaited<ReturnType<PyramidLeagueSettlementPort["acceptFriendlyChallenge"]>>>("accept_friendly_challenge_http",{p_user_id:userId,p_token:token,p_now:now});
  if(result?.error==="FRIENDLY_CHALLENGE_EXPIRED")throw new Error("FRIENDLY_CHALLENGE_EXPIRED");
  if(!result||!result.match||typeof result.replayed!=="boolean")throw new Error("SUPABASE_FRIENDLY_CHALLENGE_ACCEPT_INVALID_RESPONSE"); return result;
 }
 async getFriendlyChallengeInfo(token:string,now:string){
  const result=await this.client.rpc<Awaited<ReturnType<PyramidLeagueSettlementPort["getFriendlyChallengeInfo"]>>>("get_friendly_challenge_info_http",{p_token:token,p_now:now});
  if(result?.error==="FRIENDLY_CHALLENGE_EXPIRED")throw new Error("FRIENDLY_CHALLENGE_EXPIRED");
  if(!result||typeof result.id!=="string"||typeof result.token!=="string"||!result.creatorClub)throw new Error("SUPABASE_FRIENDLY_CHALLENGE_INFO_INVALID_RESPONSE"); return result;
 }
 async grantPurchasedChallengeCredits(userId:string,quantity:number,now:string){
  const result=await this.client.rpc<Awaited<ReturnType<PyramidLeagueSettlementPort["grantPurchasedChallengeCredits"]>>>("grant_friendly_challenge_credits_http",{p_user_id:userId,p_quantity:quantity,p_now:now});
  if(!result||typeof result.userId!=="string"||typeof result.purchasedCredits!=="number")throw new Error("SUPABASE_FRIENDLY_CHALLENGE_CREDITS_INVALID_RESPONSE"); return result;
 }

}
