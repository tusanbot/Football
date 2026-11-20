import type { CompetitionAdvancementCommand, CompetitionAdvancementPort, CompetitionAdvancementResult } from "../../../../apps/api/src/game/competition-advancement-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";
export class SupabaseCompetitionAdvancementRepository implements CompetitionAdvancementPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async advance(input:CompetitionAdvancementCommand):Promise<CompetitionAdvancementResult>{
  const result=await this.client.rpc<CompetitionAdvancementResult>("advance_competition_after_match_http",{
   p_competition_id:input.competitionId,p_round:input.round,p_now:input.now,
  });
  if(!result||typeof result!=="object"||result.competitionId!==input.competitionId
   ||!["LEAGUE","CUP"].includes(result.format)||typeof result.completed!=="boolean"
   ||typeof result.roundComplete!=="boolean"||typeof result.fixturesCreated!=="number"
   ||typeof result.noticesCreated!=="number"||typeof result.replayed!=="boolean")
   throw new Error("SUPABASE_COMPETITION_ADVANCEMENT_REJECTED");
  return result;
 }
}
