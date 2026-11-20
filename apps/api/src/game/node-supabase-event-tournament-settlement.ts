import type { EventTournamentSettlementPort } from "../event-tournament-settlement-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";
export class SupabaseEventTournamentSettlementRepository implements EventTournamentSettlementPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async finalize(competitionId:string,now:string){
  const result=await this.client.rpc<Awaited<ReturnType<EventTournamentSettlementPort["finalize"]>>>("finalize_event_tournament_http",{p_competition_id:competitionId,p_now:now});
  if(!result||typeof result.finalized!=="boolean"||typeof result.replayed!=="boolean"||typeof result.participants!=="number"||typeof result.awards!=="number")
   throw new Error("SUPABASE_EVENT_TOURNAMENT_FINALIZATION_REJECTED");
  return result;
 }
 async processDue(now:string,limit:number){
  const result=await this.client.rpc<{candidates:number;finalized:number;failed:number}>("process_due_event_tournament_finalizations_http",{p_now:now,p_limit:limit});
  if(!result||typeof result.candidates!=="number"||typeof result.finalized!=="number"||typeof result.failed!=="number")
   throw new Error("SUPABASE_EVENT_TOURNAMENT_BATCH_REJECTED");
  return result;
 }
}
