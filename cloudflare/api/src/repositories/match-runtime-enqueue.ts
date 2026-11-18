import { calculateStadiumCapacity } from "../../../../packages/domain/src/club-economy.js";
import type { MatchSide, MatchTactics } from "../../../../packages/domain/src/match-engine.js";
import type { MatchRuntimeEnqueuePort, MatchRuntimeEnqueueResult } from "../../../../apps/api/src/game/match-runtime-enqueue-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";
interface ClubSnapshot {
 id:string; ownerId:string; name:string; formation:string; mentality:string; pressing:string; tempo:string; passingStyle:string;
 stadiumLevel:number; ticketPrice:string; reputation:number; matchFallbackPlan:unknown; coachMedicalSkill:number;
 players:Array<{id:string;firstName:string;lastName:string;position:string;overall:number;lineupSlot:number|null;
 morale:number;fitness:number;attributes:unknown;suspensionMatchesRemaining:number}>;
}
interface FixtureRow { match_id:string; scheduled_at:string; home_club:ClubSnapshot; away_club:ClubSnapshot; }
function buildSide(club:ClubSnapshot):MatchSide {
 const eligible=club.players.filter(p=>p.suspensionMatchesRemaining===0);
 const starters=eligible.filter(p=>p.lineupSlot!==null).sort((a,b)=>(a.lineupSlot??99)-(b.lineupSlot??99));
 const bench=eligible.filter(p=>p.lineupSlot===null).sort((a,b)=>b.overall-a.overall||a.id.localeCompare(b.id));
 const selected=[...starters];
 if(!selected.some(p=>p.position==="GK")) { const keeper=bench.find(p=>p.position==="GK"); if(keeper){if(selected.length>=11)selected[10]=keeper;else selected.push(keeper);} }
 for(const player of bench){if(selected.length>=11)break;if(!selected.some(p=>p.id===player.id))selected.push(player);}
 const mapPlayer=(p:ClubSnapshot["players"][number])=>({id:p.id,name:p.firstName+" "+p.lastName,
 position:p.position as MatchSide["players"][number]["position"],overall:p.overall,morale:p.morale,fitness:p.fitness,
 attributes:p.attributes as MatchSide["players"][number]["attributes"]});
 return {clubId:club.id,clubName:club.name,formation:club.formation,
 tactics:{mentality:club.mentality as MatchTactics["mentality"],pressing:club.pressing as MatchTactics["pressing"],
 tempo:club.tempo as MatchTactics["tempo"],passingStyle:club.passingStyle as MatchTactics["passingStyle"]},
 stadiumCapacity:calculateStadiumCapacity(club.stadiumLevel),ticketPrice:BigInt(club.ticketPrice),reputation:club.reputation,
 coachMedicalSkill:club.coachMedicalSkill,players:selected.slice(0,11).map(mapPlayer),
 bench:bench.filter(p=>!selected.some(s=>s.id===p.id)).slice(0,7).map(mapPlayer)};
}
function validSide(side:MatchSide){return side.players.length===11&&side.players.some(p=>p.position==="GK");}
function jsonSafe(value:unknown){return JSON.parse(JSON.stringify(value,(_key,item:unknown)=>typeof item==="bigint"?item.toString():item));}
export class SupabaseMatchRuntimeEnqueueRepository implements MatchRuntimeEnqueuePort {
 constructor(private readonly client:SupabaseHttpClient){}
 async enqueue(now:string,limit:number):Promise<MatchRuntimeEnqueueResult>{
  const rows=await this.client.rpc<FixtureRow[]>("get_due_match_runtime_fixtures",{p_now:now,p_limit:Math.min(Math.max(limit,1),100)});
  if(!Array.isArray(rows))throw new Error("SUPABASE_MATCH_RUNTIME_FIXTURES_INVALID_RESPONSE");
  const snapshots:Array<{match_id:string;scheduled_at:string;kickoff_snapshot:unknown;fallback_plan:unknown}>=[];
  const invalidFixtures:Array<{id:string;ownerId:string}>=[];
  for(const row of rows){
   if(!row||typeof row.match_id!=="string"||typeof row.scheduled_at!=="string"||!row.home_club||!row.away_club)
    throw new Error("SUPABASE_MATCH_RUNTIME_FIXTURE_INVALID");
   const home=buildSide(row.home_club),away=buildSide(row.away_club);
   if(!validSide(home)||!validSide(away)){invalidFixtures.push({id:row.match_id,ownerId:row.home_club.ownerId});continue;}
   snapshots.push({match_id:row.match_id,scheduled_at:row.scheduled_at,kickoff_snapshot:jsonSafe({home,away}),
    fallback_plan:jsonSafe({home:row.home_club.matchFallbackPlan??{formation:home.formation,...home.tactics},
     away:row.away_club.matchFallbackPlan??{formation:away.formation,...away.tactics}})});
  }
  const enqueued=snapshots.length?await this.client.rpc<number>("enqueue_match_runtime_snapshots",{p_rows:snapshots}):0;
  if(!Number.isInteger(enqueued)||enqueued<0)throw new Error("SUPABASE_MATCH_RUNTIME_ENQUEUE_INVALID_RESPONSE");
  return {enqueued,invalidFixtures};
 }
}
