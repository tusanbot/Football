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
}
