import type { MatchRuntimeForfeitPort,MatchRuntimeForfeitResult } from "../../../../apps/api/src/game/match-runtime-forfeit-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";
export class SupabaseMatchRuntimeForfeitRepository implements MatchRuntimeForfeitPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async forfeit(matchId:string,now:string):Promise<MatchRuntimeForfeitResult>{
  const result=await this.client.rpc<MatchRuntimeForfeitResult>("settle_invalid_match_fixture_http",{p_match_id:matchId,p_now:now});
  if(!result||typeof result!=="object"||typeof result.settled!=="boolean"||typeof result.replayed!=="boolean"
   ||result.matchId!==matchId||(result.competitionId!==null&&typeof result.competitionId!=="string")
   ||(result.round!==null&&!Number.isInteger(result.round)))throw new Error("SUPABASE_MATCH_RUNTIME_FORFEIT_INVALID_RESPONSE");
  return result;
 }
}
