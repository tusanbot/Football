import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { NodeSupabaseEventTournamentReadRepository } from "../src/node-supabase-event-tournament-read.js";

const tournament={id:"t-1",title:"Cup",description:"Season cup",status:"REGISTRATION",competitionId:null,entryFeeAsset:null,entryFeeAmount:"0",maxParticipants:8,registrationEndsAt:"2026-12-01T00:00:00.000Z",startsAt:"2026-12-02T00:00:00.000Z",endsAt:null,createdAt:"2026-11-01T00:00:00.000Z"};
function repository(responses:Record<string,unknown>,seen:string[]=[]){
 const client=new SupabaseHttpClient({url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",fetchImpl:async(input)=>{const url=new URL(String(input));const table=url.pathname.split("/").pop()??"";seen.push(table+"?"+url.searchParams.toString());return new Response(JSON.stringify(responses[table]??[]),{status:200,headers:{"content-type":"application/json"}});}});
 return {repo:new NodeSupabaseEventTournamentReadRepository(client),seen};
}
test("public tournament reads aggregate counts, prizes, and current-user membership",async()=>{
 const {repo,seen}=repository({
  EventTournament:[tournament],
  EventTournamentParticipant:[{id:"p-1",tournamentId:"t-1",userId:"u-1",clubId:"c-1",placement:null,score:0,joinedAt:"2026-11-02T00:00:00.000Z"},{id:"p-2",tournamentId:"t-1",userId:"u-2",clubId:"c-2",placement:null,score:0,joinedAt:"2026-11-02T01:00:00.000Z"}],
  EventTournamentPrize:[{id:"pr-1",tournamentId:"t-1",placement:1,type:"GOLD",amount:"100",itemKey:null,specialPlayerId:null}]
 });
 const result=await repo.listForUser("u-1");
 assert.equal(result.length,1);
 assert.equal(result[0]?.participantCount,2);
 assert.equal(result[0]?.joined,true);
 assert.equal(result[0]?.participantId,"p-1");
 assert.equal((result[0]?.prizes as unknown[]).length,1);
 assert.deepEqual(seen.map(x=>x.split("?")[0]).sort(),["EventTournament","EventTournamentParticipant","EventTournamentPrize"].sort());
});
test("admin tournament reads return participant counts and prize details",async()=>{
 const {repo}=repository({EventTournament:[tournament],EventTournamentParticipant:[{tournamentId:"t-1"},{tournamentId:"t-1"}],EventTournamentPrize:[]});
 const result=await repo.listForAdmin();
 assert.equal(result[0]?.participantCount,2);
 assert.equal(result[0]?.entryFeeAmount,"0");
});
test("participant reads resolve user and club references",async()=>{
 const {repo}=repository({
  EventTournamentParticipant:[{id:"p-1",tournamentId:"t-1",userId:"u-1",clubId:"c-1",placement:1,score:10,joinedAt:"2026-11-02T00:00:00.000Z"}],
  User:[{id:"u-1",telegramId:"12345",username:"player",displayName:"Player"}],
  Club:[{id:"c-1",name:"Tosan FC"}]
 });
 const result=await repo.listParticipants("t-1");
 assert.deepEqual(result[0],{id:"p-1",telegramId:"12345",displayName:"Player",username:"player",clubName:"Tosan FC",score:10,placement:1,joinedAt:"2026-11-02T00:00:00.000Z"});
});
test("participant reads reject broken foreign-key references",async()=>{
 const {repo}=repository({EventTournamentParticipant:[{id:"p-1",tournamentId:"t-1",userId:"u-1",clubId:"c-1",placement:null,score:0,joinedAt:"2026-11-02T00:00:00.000Z"}],User:[],Club:[]});
 await assert.rejects(()=>repo.listParticipants("t-1"),/REFERENCE_MISSING/);
});

test("event tournament creation uses the atomic Supabase RPC",async()=>{
 let requestUrl="";let requestBody:Record<string,unknown>|undefined;
 const client=new SupabaseHttpClient({url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",fetchImpl:async(input,init)=>{
  requestUrl=String(input);requestBody=JSON.parse(String(init?.body)) as Record<string,unknown>;
  return new Response(JSON.stringify({tournament:{id:"t-created",title:"Cup",status:"REGISTRATION"},replayed:false}),{status:200,headers:{"content-type":"application/json"}});
 }});
 const repo=new NodeSupabaseEventTournamentReadRepository(client);
 const result=await repo.create({telegramUserId:"12345",idempotencyKey:"create-cup-123456",title:"Cup",description:"Season cup",
  entryFeeAsset:"GOLD",entryFeeAmount:"10",maxParticipants:8,registrationEndsAt:"2026-12-01T00:00:00.000Z",
  startsAt:"2026-12-02T00:00:00.000Z",endsAt:null,
  prizes:[{placement:1,type:"HONOR",amount:"100",itemKey:null,specialPlayerId:null}]});
 assert.equal(new URL(requestUrl).pathname,"/rest/v1/rpc/create_event_tournament_http");
 assert.equal(requestBody?.p_telegram_user_id,"12345");
 assert.equal(requestBody?.p_idempotency_key,"event-tournament-create:create-cup-123456");
 assert.equal(requestBody?.p_entry_fee_amount,"10");
 assert.equal(result.tournament.id,"t-created");
 assert.equal(result.replayed,false);
});
