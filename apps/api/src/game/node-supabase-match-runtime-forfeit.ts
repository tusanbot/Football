import type { MatchRuntimeForfeitPort,MatchRuntimeForfeitResult } from "./match-runtime-forfeit-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";
export class SupabaseMatchRuntimeForfeitRepository implements MatchRuntimeForfeitPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async forfeit(matchId:string,now:string):Promise<MatchRuntimeForfeitResult>{
  const result=await this.client.rpc<MatchRuntimeForfeitResult>("settle_invalid_match_fixture_and_advance_http",{p_match_id:matchId,p_now:now});
  if(!result||typeof result!=="object"||typeof result.settled!=="boolean"||typeof result.replayed!=="boolean"
   ||result.matchId!==matchId||(result.competitionId!==null&&typeof result.competitionId!=="string")
   ||(result.round!==null&&!Number.isInteger(result.round))||!("advancement" in result))throw new Error("SUPABASE_MATCH_RUNTIME_FORFEIT_INVALID_RESPONSE");
  if((result.settled||result.replayed)&&result.competitionId&&result.round!==null){
   const advancement=result.advancement;
   if(!advancement||advancement.competitionId!==result.competitionId
    ||!(["LEAGUE","CUP"] as string[]).includes(advancement.format)
    ||typeof advancement.completed!=="boolean"||typeof advancement.roundComplete!=="boolean"
    ||typeof advancement.fixturesCreated!=="number"||typeof advancement.noticesCreated!=="number"
    ||typeof advancement.replayed!=="boolean")throw new Error("SUPABASE_MATCH_RUNTIME_FORFEIT_ADVANCEMENT_INVALID_RESPONSE");
  }else if(result.advancement!==null)throw new Error("SUPABASE_MATCH_RUNTIME_FORFEIT_ADVANCEMENT_INVALID_RESPONSE");
  return result;
 }
}
