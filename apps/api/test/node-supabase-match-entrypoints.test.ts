import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { SupabaseMatchOpponentRepository } from "../src/game/node-supabase-match-opponents.js";
import { SupabaseFriendlyMatchCreationRepository } from "../src/game/node-supabase-friendly-match-creation.js";
import { SupabaseCompetitionCreationRepository } from "../src/game/node-supabase-competition-creation.js";
import { withMatchOpponentPort } from "../src/game/match-opponents-context.js";
import { withFriendlyMatchCreationPort } from "../src/game/friendly-match-creation-context.js";
import { withCompetitionCreationPort } from "../src/game/competition-creation-context.js";
import { listMatchOpponents, createFriendlyMatch, createLeague, updateCompetitionRules, joinLeague, startLeague } from "../src/game/match-service.js";

const url="https://example.supabase.co", key="match-entrypoints-service-role-test-key";
function client(responses:unknown[]){
 const calls:Array<{path:string;body:Record<string,unknown>;authorization:string|null}>=[];
 const http=new SupabaseHttpClient({url,serviceRoleKey:key,fetchImpl:async(input,init)=>{
  calls.push({path:new URL(String(input)).pathname,body:JSON.parse(String(init?.body)) as Record<string,unknown>,authorization:new Headers(init?.headers).get("authorization")});
  return new Response(JSON.stringify(responses.shift()),{status:200,headers:{"content-type":"application/json"}});
 }});
 return {http,calls};
}
const match={id:"match-1",idempotencyKey:"friendly-key-123",type:"FRIENDLY",status:"SCHEDULED",homeClubId:"home",awayClubId:"away",competitionId:null,rulesSnapshot:{},tieId:null,leg:1,round:null,scheduledAt:"2026-11-21T12:00:00.000Z",startedAt:null,completedAt:null,seed:"seed-1",simulationVersion:1,homeScore:null,awayScore:null,homePenalties:null,awayPenalties:null,winnerClubId:null,attendance:0,ticketRevenue:"0",homeExpectedGoals:null,awayExpectedGoals:null,createdAt:"2026-11-20T12:00:00.000Z",updatedAt:"2026-11-20T12:00:00.000Z"};
const competition={id:"competition-1",idempotencyKey:"league-key-123",name:"Autumn League",season:2026,format:"LEAGUE",status:"REGISTRATION",maxTeams:4,cupLegs:1,rules:{penaltiesOnDraw:false},createdByClubId:"home",groupId:null,allianceId:null,allianceSeasonId:null,startsAt:null,completedAt:null,createdAt:"2026-11-20T12:00:00.000Z",updatedAt:"2026-11-20T12:00:00.000Z"};

test("opponent discovery uses authenticated HTTP RPC, bounds search and validates response",async()=>{
 const opponent={id:"away",name:"Away FC",level:5,reputation:120,ownerTelegramId:"tg-2",ownerUsername:null,lastActiveAt:"2026-11-20T10:00:00.000Z"};
 const {http,calls}=client([[opponent]]);
 assert.deepEqual(await new SupabaseMatchOpponentRepository(http).list("user-1","x".repeat(100)),[opponent]);
 assert.equal(calls.length,1);
 assert.equal(calls[0]!.path,"/rest/v1/rpc/list_match_opponents_http");
 assert.deepEqual(calls[0]!.body,{p_user_id:"user-1",p_search:"x".repeat(80)});
 assert.equal(calls[0]!.authorization,"Bearer "+key);
 await assert.rejects(()=>new SupabaseMatchOpponentRepository(client([[{...opponent,level:"five"}]]).http).list("user-1"),/SUPABASE_MATCH_OPPONENTS_INVALID_RESPONSE/);
});

test("friendly match creation uses one atomic RPC and validates its complete record",async()=>{
 const scheduledAt=new Date("2026-11-21T12:00:00.000Z");
 const {http,calls}=client([{match,replayed:false}]);
 const result=await new SupabaseFriendlyMatchCreationRepository(http).create("user-1","away","friendly-key-123",scheduledAt);
 assert.equal(result.match.id,"match-1");
 assert.equal(result.replayed,false);
 assert.equal(calls.length,1);
 assert.equal(calls[0]!.path,"/rest/v1/rpc/create_friendly_match_http");
 assert.deepEqual(calls[0]!.body,{p_user_id:"user-1",p_opponent_club_id:"away",p_idempotency_key:"friendly-key-123",p_scheduled_at:scheduledAt.toISOString()});
 await assert.rejects(()=>new SupabaseFriendlyMatchCreationRepository(client([{match:{id:"match-1"},replayed:false}]).http).create("user-1","away","friendly-key-123",scheduledAt),/SUPABASE_FRIENDLY_MATCH_INVALID_RESPONSE/);
});

test("competition create, rules, join and start map to their dedicated RPCs",async()=>{
 const now=new Date("2026-11-20T12:00:00.000Z");
 const joined={joined:true,replayed:false,teams:2,autoStarted:false};
 const started={replayed:false,teams:4,fixturesCreated:6,rounds:3};
 const {http,calls}=client([{competition,replayed:false},{competitionId:"competition-1",rules:{penaltiesOnDraw:false,extraTime:true}},joined,started]);
 const repo=new SupabaseCompetitionCreationRepository(http);
 const created=await repo.create({userId:"user-1",name:"Autumn League",maxTeams:4,idempotencyKey:"league-key-123",format:"LEAGUE",cupLegs:1,season:2026,rules:{penaltiesOnDraw:false},now});
 assert.equal((created.competition as Record<string,unknown>).id,"competition-1");
 await repo.updateRules("user-1","competition-1",{penaltiesOnDraw:false,extraTime:true},now);
 assert.deepEqual(await repo.join("user-2","competition-1",now),joined);
 assert.deepEqual(await repo.start("user-1","competition-1",now),started);
 assert.deepEqual(calls.map(x=>x.path),["/rest/v1/rpc/create_competition_http","/rest/v1/rpc/update_competition_rules_http","/rest/v1/rpc/join_competition_http","/rest/v1/rpc/start_competition_http"]);
 assert.deepEqual(calls[0]!.body,{p_user_id:"user-1",p_name:"Autumn League",p_max_teams:4,p_idempotency_key:"league-key-123",p_format:"LEAGUE",p_cup_legs:1,p_season:2026,p_rules:{penaltiesOnDraw:false},p_now:now.toISOString()});
});

test("match service delegates all entrypoint mutations and opponent discovery to scoped ports",async()=>{
 const calls:string[]=[];
 const scheduledAt=new Date(Date.now()+60_000);
 const opponent={id:"away",name:"Away FC",level:5,reputation:120,ownerTelegramId:"tg-2",ownerUsername:null,lastActiveAt:"2026-11-20T10:00:00.000Z"};
 await withMatchOpponentPort({async list(userId,search){calls.push("opponents:"+userId+":"+search);return [opponent];}},async()=>{
  assert.deepEqual(await listMatchOpponents("user-1","Away"),[opponent]);
 });
 await withFriendlyMatchCreationPort({async create(userId,opponentId,idempotencyKey,date){calls.push("friendly:"+userId+":"+opponentId+":"+idempotencyKey);return {match,replayed:false};}},async()=>{
  assert.equal((await createFriendlyMatch("user-1","away","friendly-key-123",scheduledAt)).replayed,false);
 });
 const port={
  async create(input:{userId:string;name:string;maxTeams:number;idempotencyKey:string;format:"LEAGUE"|"CUP";cupLegs:number;season:number;rules:Record<string,boolean|number>;now:Date}){calls.push("create:"+input.userId);return {competition,replayed:false};},
  async updateRules(userId:string,id:string,rules:Record<string,boolean|number>){calls.push("rules:"+userId+":"+id);return {competitionId:id,rules};},
  async join(userId:string,id:string){calls.push("join:"+userId+":"+id);return {joined:true,replayed:false,teams:2,autoStarted:false};},
  async start(userId:string,id:string){calls.push("start:"+userId+":"+id);return {replayed:false,teams:4,fixturesCreated:6,rounds:3};},
 };
 await withCompetitionCreationPort(port,async()=>{
  assert.equal((await createLeague("user-1","Autumn League",4,"league-key-123")).replayed,false);
  await updateCompetitionRules("user-1","competition-1",{penaltiesOnDraw:false});
  await joinLeague("user-2","competition-1");
  await startLeague("user-1","competition-1");
 });
 assert.deepEqual(calls,["opponents:user-1:Away","friendly:user-1:away:friendly-key-123","create:user-1","rules:user-1:competition-1","join:user-2:competition-1","start:user-1:competition-1"]);
});
