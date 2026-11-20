import type { EventTournamentCreateInput, EventTournamentReadPort } from "./event-tournament-read-context.js";
import { SupabaseHttpClient } from "./node-supabase-http.js";
type Tournament={id:string;title:string;description:string;status:string;competitionId?:string|null;entryFeeAsset:string|null;entryFeeAmount:string|number;maxParticipants:number;registrationEndsAt:string;startsAt:string;endsAt:string|null;createdAt?:string};
type Participant={id:string;tournamentId:string;userId:string;clubId:string;placement:number|null;score:number;joinedAt:string};
type Prize={id:string;tournamentId:string;placement:number;type:string;amount:string|number;itemKey:string|null;specialPlayerId:string|null};
function rows<T>(value:unknown):T[]{if(!Array.isArray(value))throw new Error("SUPABASE_EVENT_TOURNAMENT_INVALID_RESPONSE");return value as T[];}
function inFilter(values:string[]){return "in.("+values.map(v=>'"'+v.replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"').join(",")+")";}
function iso(v:string|null){return v?new Date(v).toISOString():null;}
export class NodeSupabaseEventTournamentReadRepository implements EventTournamentReadPort{
 constructor(private readonly client:SupabaseHttpClient){}
 async create(input:EventTournamentCreateInput){
  const result=await this.client.rpc<{tournament:Record<string,unknown>;replayed:boolean}>("create_event_tournament_http",{
   p_telegram_user_id:input.telegramUserId,p_idempotency_key:"event-tournament-create:"+input.idempotencyKey,
   p_title:input.title,p_description:input.description,p_entry_fee_asset:input.entryFeeAsset,
   p_entry_fee_amount:input.entryFeeAmount,p_max_participants:input.maxParticipants,
   p_registration_ends_at:input.registrationEndsAt,p_starts_at:input.startsAt,p_ends_at:input.endsAt,
   p_prizes:input.prizes,p_now:new Date().toISOString()
  });
  if(!result||typeof result!=="object"||!result.tournament||typeof result.tournament!=="object"||typeof result.replayed!=="boolean")
   throw new Error("SUPABASE_EVENT_TOURNAMENT_CREATE_INVALID_RESPONSE");
  return result;
 }
 async listForUser(userId:string){
  const ts=rows<Tournament>(await this.client.select("EventTournament",{select:"id,title,description,status,competitionId,entryFeeAsset,entryFeeAmount,maxParticipants,registrationEndsAt,startsAt,endsAt",status:"in.(REGISTRATION,ACTIVE,COMPLETED)",order:"status.asc,startsAt.desc",limit:"40"}));
  if(!ts.length)return [];
  const ids=ts.map(x=>x.id);
  const [ps,pr]=await Promise.all([
   this.client.select<Participant[]>("EventTournamentParticipant",{select:"id,tournamentId,userId,placement,joinedAt",tournamentId:inFilter(ids)}),
   this.client.select<Prize[]>("EventTournamentPrize",{select:"id,tournamentId,placement,type,amount,itemKey,specialPlayerId",tournamentId:inFilter(ids),order:"placement.asc,type.asc"})
  ]);
  const participantRows=rows<Participant>(ps);
  const counts=new Map<string,number>();for(const p of participantRows)counts.set(p.tournamentId,(counts.get(p.tournamentId)??0)+1);
  const joined=new Map(participantRows.filter(x=>x.userId===userId).map(x=>[x.tournamentId,x]));
  const prizes=new Map<string,Prize[]>();for(const p of rows<Prize>(pr))prizes.set(p.tournamentId,[...(prizes.get(p.tournamentId)??[]),p]);
  return ts.map(x=>{const p=joined.get(x.id);return{id:x.id,title:x.title,description:x.description,status:x.status,competitionId:x.competitionId??null,entryFeeAsset:x.entryFeeAsset,entryFeeAmount:String(x.entryFeeAmount),maxParticipants:x.maxParticipants,participantCount:counts.get(x.id)??0,registrationEndsAt:iso(x.registrationEndsAt),startsAt:iso(x.startsAt),endsAt:iso(x.endsAt),prizes:(prizes.get(x.id)??[]).map(v=>({placement:v.placement,type:v.type,amount:String(v.amount),itemKey:v.itemKey,specialPlayerId:v.specialPlayerId})),joined:Boolean(p),participantId:p?.id??null,placement:p?.placement??null};});
 }
 async listForAdmin(){
  const ts=rows<Tournament>(await this.client.select("EventTournament",{select:"id,title,description,status,entryFeeAsset,entryFeeAmount,maxParticipants,registrationEndsAt,startsAt,endsAt,createdAt",order:"createdAt.desc",limit:"50"}));
  if(!ts.length)return [];
  const ids=ts.map(x=>x.id);
  const [ps,pr]=await Promise.all([
   this.client.select<Array<{tournamentId:string}>>("EventTournamentParticipant",{select:"tournamentId",tournamentId:inFilter(ids)}),
   this.client.select<Prize[]>("EventTournamentPrize",{select:"id,tournamentId,placement,type,amount,itemKey,specialPlayerId",tournamentId:inFilter(ids),order:"placement.asc,type.asc"})
  ]);
  const counts=new Map<string,number>();for(const p of rows<{tournamentId:string}>(ps))counts.set(p.tournamentId,(counts.get(p.tournamentId)??0)+1);
  const prizes=new Map<string,Prize[]>();for(const p of rows<Prize>(pr))prizes.set(p.tournamentId,[...(prizes.get(p.tournamentId)??[]),p]);
  return ts.map(x=>({id:x.id,title:x.title,description:x.description,status:x.status,entryFeeAsset:x.entryFeeAsset,entryFeeAmount:String(x.entryFeeAmount),maxParticipants:x.maxParticipants,participantCount:counts.get(x.id)??0,registrationEndsAt:iso(x.registrationEndsAt),startsAt:iso(x.startsAt),endsAt:iso(x.endsAt),prizes:(prizes.get(x.id)??[]).map(p=>({id:p.id,placement:p.placement,type:p.type,amount:String(p.amount),itemKey:p.itemKey,specialPlayerId:p.specialPlayerId}))}));
 }
 async listParticipants(tournamentId:string){
  const ps=rows<Participant>(await this.client.select("EventTournamentParticipant",{select:"id,tournamentId,userId,clubId,placement,score,joinedAt",tournamentId:"eq."+tournamentId,order:"score.desc,joinedAt.asc"}));
  if(!ps.length)return [];
  const uids=[...new Set(ps.map(x=>x.userId))],cids=[...new Set(ps.map(x=>x.clubId))];
  const [us,cs]=await Promise.all([
   this.client.select<Array<{id:string;telegramId:string;username:string|null;displayName:string|null}>>("User",{select:"id,telegramId,username,displayName",id:inFilter(uids)}),
   this.client.select<Array<{id:string;name:string}>>("Club",{select:"id,name",id:inFilter(cids)})
  ]);
  const users=new Map(rows<{id:string;telegramId:string;username:string|null;displayName:string|null}>(us).map(x=>[x.id,x]));
  const clubs=new Map(rows<{id:string;name:string}>(cs).map(x=>[x.id,x]));
  return ps.map(p=>{const u=users.get(p.userId),c=clubs.get(p.clubId);if(!u||!c)throw new Error("SUPABASE_EVENT_TOURNAMENT_REFERENCE_MISSING");return{id:p.id,telegramId:u.telegramId,displayName:u.displayName,username:u.username,clubName:c.name,score:p.score,placement:p.placement,joinedAt:iso(p.joinedAt)};});
 }
}
