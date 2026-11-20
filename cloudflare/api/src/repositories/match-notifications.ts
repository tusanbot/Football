import { SupabaseHttpClient } from "../supabase-http.js";
export interface MatchNotificationPerformance { clubId: string; goals: number; shots: number; passes: number; tackles: number; playerName: string; }
export interface MatchNotificationRow {
 type:"LIFECYCLE"|"RESULT"; id:string; claimToken:string; telegramChatId:string; kind:string; minute:number;
 homeScore:number|null; awayScore:number|null; homeClubId:string|null; awayClubId:string|null;
 homeClubName:string|null; awayClubName:string|null; payload:Record<string,unknown>|null; performances:MatchNotificationPerformance[];
}
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v);}
function parse(v:unknown,type:MatchNotificationRow["type"]):MatchNotificationRow[]{
 if(!Array.isArray(v))throw new Error("SUPABASE_MATCH_NOTIFICATIONS_INVALID_RESPONSE");
 return v.map(x=>{
  if(!object(x)||typeof x.id!=="string"||typeof x.claim_token!=="string"||typeof x.telegram_chat_id!=="string")throw new Error("SUPABASE_MATCH_NOTIFICATIONS_INVALID_ROW");
  const performances=Array.isArray(x.performances)?x.performances.map(p=>{
   if(!object(p)||typeof p.club_id!=="string"||typeof p.player_name!=="string"||!["goals","shots","passes","tackles"].every(k=>Number.isInteger(p[k])))throw new Error("SUPABASE_MATCH_NOTIFICATIONS_INVALID_PERFORMANCE");
   return {clubId:p.club_id as string,playerName:p.player_name as string,goals:p.goals as number,shots:p.shots as number,passes:p.passes as number,tackles:p.tackles as number};
  }):[];
  return {type,id:x.id,claimToken:x.claim_token,telegramChatId:x.telegram_chat_id,kind:typeof x.kind==="string"?x.kind:"RESULT",
   minute:Number.isInteger(x.minute)?x.minute as number:0,homeScore:Number.isInteger(x.home_score)?x.home_score as number:null,
   awayScore:Number.isInteger(x.away_score)?x.away_score as number:null,homeClubId:typeof x.home_club_id==="string"?x.home_club_id:null,
   awayClubId:typeof x.away_club_id==="string"?x.away_club_id:null,homeClubName:typeof x.home_club_name==="string"?x.home_club_name:null,
   awayClubName:typeof x.away_club_name==="string"?x.away_club_name:null,payload:object(x.payload)?x.payload:null,performances};
 });
}
export class SupabaseMatchNotificationRepository{
 constructor(private readonly client:SupabaseHttpClient){}
 async claimDue(limit=50,leaseSeconds=30):Promise<MatchNotificationRow[]>{
  const [l,r]=await Promise.all([
   this.client.rpc<unknown>("claim_due_match_lifecycle_notifications",{p_limit:limit,p_lease_seconds:leaseSeconds}),
   this.client.rpc<unknown>("claim_due_match_result_notifications",{p_limit:limit,p_lease_seconds:leaseSeconds})
  ]);
  return [...parse(l,"LIFECYCLE"),...parse(r,"RESULT")];
 }
 async complete(type:MatchNotificationRow["type"],id:string,claimToken:string,delivered:boolean,error:string|null,retrySeconds=15):Promise<void>{
  const ok=await this.client.rpc<unknown>("complete_match_notification_delivery",{p_notification_type:type,p_notification_id:id,p_claim_token:claimToken,p_delivered:delivered,p_error:error,p_retry_seconds:retrySeconds});
  if(ok!==true&&!(Array.isArray(ok)&&ok[0]===true))throw new Error("SUPABASE_MATCH_NOTIFICATION_COMPLETION_REJECTED");
 }
}
