import type { MatchCheckpointNotification, MatchLifecycleNotification, MatchNotificationPort, MatchResultNotification } from "./match-notification-routes.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";
function rows(value:unknown,label:string):Record<string,unknown>[]{
 if(!Array.isArray(value))throw new Error("SUPABASE_MATCH_NOTIFICATION_INVALID_"+label);
 return value.map(v=>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("SUPABASE_MATCH_NOTIFICATION_INVALID_ROW");return v as Record<string,unknown>;});
}
function str(v:unknown,label:string):string{if(typeof v!=="string")throw new Error("SUPABASE_MATCH_NOTIFICATION_INVALID_"+label);return v;}
function int(v:unknown,label:string):number{if(!Number.isInteger(v))throw new Error("SUPABASE_MATCH_NOTIFICATION_INVALID_"+label);return v as number;}
function nullableInt(v:unknown,label:string):number|null{return v===null||v===undefined?null:int(v,label);}
function nullableString(v:unknown,label:string):string|null{return v===null||v===undefined?null:str(v,label);}
export class NodeSupabaseMatchNotificationRepository implements MatchNotificationPort{
 constructor(private readonly client:SupabaseHttpClient){}
 async claimResults(limit:number):Promise<MatchResultNotification[]>{
  return rows(await this.client.rpc<unknown>("claim_due_match_result_notifications_node_http",{p_limit:limit,p_lease_seconds:30}),"RESULTS").map(row=>{
   const performances=rows(row.performances,"PERFORMANCES");
   const homeId=str(row.home_club_id,"HOME_CLUB_ID"),awayId=str(row.away_club_id,"AWAY_CLUB_ID");
   const stat=(clubId:string)=>({shots:performances.filter(p=>p.club_id===clubId).reduce((n,p)=>n+int(p.shots,"SHOTS"),0),
    passes:performances.filter(p=>p.club_id===clubId).reduce((n,p)=>n+int(p.passes,"PASSES"),0),
    tackles:performances.filter(p=>p.club_id===clubId).reduce((n,p)=>n+int(p.tackles,"TACKLES"),0)});
   return {id:str(row.id,"ID"),channel:str(row.channel,"CHANNEL"),telegramChatId:str(row.telegram_chat_id,"CHAT_ID"),
    claimToken:str(row.claim_token,"CLAIM_TOKEN"),attempt:int(row.attempt,"ATTEMPT"),
    match:{id:str(row.match_id,"MATCH_ID"),homeClub:str(row.home_club_name,"HOME_NAME"),awayClub:str(row.away_club_name,"AWAY_NAME"),
     homeScore:nullableInt(row.home_score,"HOME_SCORE"),awayScore:nullableInt(row.away_score,"AWAY_SCORE"),
     completedAt:nullableString(row.completed_at,"COMPLETED_AT"),statistics:{home:stat(homeId),away:stat(awayId)},
     scorers:performances.filter(p=>int(p.goals,"GOALS")>0).map(p=>({player:str(p.player_name,"PLAYER_NAME"),goals:int(p.goals,"GOALS")}))}};
  });
 }
 async claimLifecycle(limit:number):Promise<MatchLifecycleNotification[]>{
  return rows(await this.client.rpc<unknown>("claim_due_match_lifecycle_notifications_node_http",{p_limit:limit,p_lease_seconds:30}),"LIFECYCLE").map(row=>{
   const payload=row.payload===null||row.payload===undefined?null:row.payload as Record<string,unknown>;
   return {id:str(row.id,"ID"),channel:str(row.channel,"CHANNEL"),telegramChatId:str(row.telegram_chat_id,"CHAT_ID"),
    claimToken:str(row.claim_token,"CLAIM_TOKEN"),attempt:int(row.attempt,"ATTEMPT"),kind:str(row.kind,"KIND"),
    minute:int(row.minute,"MINUTE"),homeScore:nullableInt(row.home_score,"HOME_SCORE"),awayScore:nullableInt(row.away_score,"AWAY_SCORE"),
    payload,match:{id:str(row.match_id,"MATCH_ID"),homeClub:str(row.home_club_name,"HOME_NAME"),awayClub:str(row.away_club_name,"AWAY_NAME")}};
  });
 }
 async complete(type:"RESULT"|"LIFECYCLE",id:string,claimToken:string,delivered:boolean,error:string|null,retrySeconds:number):Promise<boolean>{
  const value=await this.client.rpc<unknown>("complete_match_notification_delivery",{p_notification_type:type,p_notification_id:id,
   p_claim_token:claimToken,p_delivered:delivered,p_error:error,p_retry_seconds:retrySeconds});
  if(typeof value!=="boolean")throw new Error("SUPABASE_MATCH_NOTIFICATION_INVALID_COMPLETION");
  return value;
 }
 async claimCheckpoints(limit:number,checkpointId?:string):Promise<MatchCheckpointNotification[]>{
  return rows(await this.client.rpc<unknown>("claim_due_match_checkpoint_notifications_node_http",{p_limit:limit,p_checkpoint_id:checkpointId??null}),"CHECKPOINTS").map(row=>({
   checkpointId:str(row.checkpoint_id,"CHECKPOINT_ID"),matchId:str(row.match_id,"MATCH_ID"),checkpointKey:str(row.checkpoint_key,"CHECKPOINT_KEY"),
   minute:int(row.minute,"MINUTE"),deadlineAt:str(row.deadline_at,"DEADLINE_AT"),clubId:str(row.club_id,"CLUB_ID"),
   clubName:str(row.club_name,"CLUB_NAME"),opponentName:str(row.opponent_name,"OPPONENT_NAME"),
   telegramUserId:str(row.telegram_user_id,"TELEGRAM_USER_ID"),side:str(row.side,"SIDE") as "HOME"|"AWAY",attempt:int(row.attempt,"ATTEMPT"),claimToken:str(row.claim_token,"CLAIM_TOKEN")
  }));
 }
 async acknowledgeCheckpoint(checkpointId:string,side:"HOME"|"AWAY",claimToken:string,delivered:boolean,error:string|null):Promise<boolean>{
  const value=await this.client.rpc<unknown>("ack_match_checkpoint_notification_node_http",{p_checkpoint_id:checkpointId,p_side:side,p_claim_token:claimToken,p_delivered:delivered,p_error:error});
  if(typeof value!=="boolean")throw new Error("SUPABASE_MATCH_NOTIFICATION_INVALID_CHECKPOINT_ACK");
  return value;
 }
}
