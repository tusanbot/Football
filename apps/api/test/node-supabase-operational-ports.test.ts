import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient, SupabaseHttpError } from "../src/node-supabase-http.js";
import { SupabaseGameDashboardRepository } from "../src/game/node-supabase-game-dashboard.js";
import { NodeSupabasePublicPlayerRecordRepository } from "../src/players/node-supabase-public-records.js";
import { NodeSupabasePublicClubLogoRepository } from "../src/node-supabase-public-club-logo.js";
import { SupabaseEventTournamentSettlementRepository } from "../src/game/node-supabase-event-tournament-settlement.js";
import { SupabaseClubLineupRepository } from "../src/game/node-supabase-club-lineup.js";
import { NodeSupabaseWalletReadRepository } from "../src/economy/node-supabase-wallet-read.js";
import { SupabaseClubManagementRepository as NodeSupabaseClubManagementRepository } from "../src/game/node-supabase-club-management.js";
import { SupabaseSpecialAcquisitionRepository as NodeSupabaseSpecialAcquisitionRepository } from "../src/players/node-supabase-special-acquisition.js";
import { SupabaseGiftCodeRedemptionRepository as NodeSupabaseGiftCodeRedemptionRepository } from "../src/node-supabase-gift-code-redemption.js";
import { SupabaseBotRuntimeLeaseRepository as NodeSupabaseBotRuntimeLeaseRepository } from "../src/node-supabase-bot-runtime-lease.js";

function clientWith(handler:(url:URL,init:RequestInit)=>unknown) {
 const calls:Array<{url:URL;init:RequestInit}>=[];
 const client=new SupabaseHttpClient({url:"https://project.supabase.co",serviceRoleKey:"x".repeat(40),fetchImpl:async(input,init={})=>{
  const url=new URL(String(input));calls.push({url,init});
  const value=handler(url,init);return new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});
 }});
 return {client,calls};
}

test("club management uses atomic command RPC and academy level read",async()=>{
 const f=clientWith((url)=>url.pathname.endsWith("/rpc/club_management_command")?{ok:true}:[{academyLevel:3}]);
 const repo=new NodeSupabaseClubManagementRepository(f.client);
 assert.equal(await repo.getAcademyLevel("user-1"),3);
 await repo.execute("UPGRADE_FACILITY","user-1","operation-key-1234",{facility:"STADIUM"},new Date("2026-11-19T12:00:00Z"));
 assert.equal(f.calls[1]!.url.pathname,"/rest/v1/rpc/club_management_command");
 const body=JSON.parse(String(f.calls[1]!.init.body));
 assert.equal(body.p_action,"UPGRADE_FACILITY");assert.equal(body.p_user_id,"user-1");assert.equal(body.p_payload.facility,"STADIUM");
});

test("special player catalog is read through Supabase PostgREST",async()=>{
 const f=clientWith((url)=>[{id:"sp1",slug:"legend",fullName:"Legend",nationality:"IR",birthDate:"1970-01-01",positions:["ST"],rarity:"ICON",overall:95,potential:95,attributes:{pace:90},acquisitionMethods:["icon_pack"]}]);
 const repo=new NodeSupabaseSpecialAcquisitionRepository(f.client);
 const players=await repo.listActive();
 assert.equal(players.length,1);
 assert.equal(f.calls[0]!.url.pathname,"/rest/v1/SpecialPlayer");
 assert.equal(f.calls[0]!.url.searchParams.get("active"),"eq.true");
 assert.equal(f.calls[0]!.url.searchParams.get("order"),"rarity.desc,overall.desc");
 assert.equal(f.calls[0]!.url.searchParams.get("select"),"id,slug,fullName,nationality,birthDate,positions,rarity,overall,potential,attributes,acquisitionMethods");
});

test("special acquisition validates and maps RPC response and legacy challenge operations",async()=>{
 const f=clientWith((url)=>url.pathname.endsWith("/rpc/acquire_special_player")?[{acquisition_id:"a1",player_id:"p1",method:"epic_pack",special_player:{id:"sp1",fullName:"Legend Player",rarity:"EPIC",overall:90},gold_balance:"750",replayed:false}]
 :url.pathname.endsWith("/rpc/list_legacy_special_challenges")?[{challenges:[]}]:[{result:{acquisitionId:"a2",playerId:"p2",specialPlayer:{id:"sp2",fullName:"Hero",rarity:"ICON",overall:95},replayed:false}}]);
 const repo=new NodeSupabaseSpecialAcquisitionRepository(f.client);
 const result=await repo.acquire({userId:"u1",method:"epic_pack",idempotencyKey:"key-12345678"});
 assert.equal(result.playerId,"p1");assert.equal(result.goldBalance,"750");
 assert.deepEqual((await repo.listLegacyChallenges("u1")).challenges,[]);
 assert.equal((await repo.claimLegacyChallenge("u1","win-10")).playerId,"p2");
});

test("gift code rate limit, preflight and redemption use Supabase RPC",async()=>{
 const f=clientWith((url)=>url.pathname.endsWith("/rpc/consume_gift_code_rate_limit")?[true]
 :url.pathname.endsWith("/rpc/get_gift_code_reward_type")?["GROUP_POINTS"]
 :[{cash:"100",gold:"2",group_points:"5",replayed:false}]);
 const repo=new NodeSupabaseGiftCodeRedemptionRepository(f.client);
 assert.equal(await repo.consumeRateLimit({telegramUserId:"123456789",limit:5}),true);
 assert.equal(await repo.getRewardType("GROUP1"),"GROUP_POINTS");
 const result=await repo.redeem({userId:"u1",code:"GROUP1",idempotencyKey:"gift-key-123456",telegramGroupId:"-1001234567890"});
 assert.deepEqual(result.reward,{cash:"100",gold:"2",groupPoints:"5"});
 assert.equal(f.calls[2]!.url.pathname,"/rest/v1/rpc/redeem_gift_code");
});

test("bot runtime lease validates RPC contract and action arguments",async()=>{
 const f=clientWith(()=>({acquired:true,released:false,leaseExpiresAt:"2026-11-19T12:01:00.000Z"}));
 const repo=new NodeSupabaseBotRuntimeLeaseRepository(f.client);
 const result=await repo.execute("123e4567-e89b-12d3-a456-426614174000","acquire","2026-11-19T12:00:00.000Z");
 assert.equal(result.acquired,true);
 assert.equal(f.calls[0]!.url.pathname,"/rest/v1/rpc/manage_bot_runtime_lease_http");
 const body=JSON.parse(String(f.calls[0]!.init.body));assert.equal(body.p_lease_seconds,60);assert.equal(body.p_action,"acquire");
});

test("special acquisition translates known Supabase errors",async()=>{
 const client=new SupabaseHttpClient({url:"https://project.supabase.co",serviceRoleKey:"x".repeat(40),fetchImpl:async()=>new Response(JSON.stringify({message:"INSUFFICIENT_GOLD"}),{status:400})});
 const repo=new NodeSupabaseSpecialAcquisitionRepository(client);
 await assert.rejects(repo.acquire({userId:"u1",method:"epic_pack",idempotencyKey:"key-12345678"}),/INSUFFICIENT_GOLD/);
});

test("club operations dashboard reads its aggregates through PostgREST",async()=>{
 const club={id:"club-1",name:"Tosan",level:4,reputation:120,stadiumLevel:3,ticketPrice:25,trainingGroundLevel:2,academyLevel:1,operatingArrears:"50"};
 const f=clientWith((url)=>{
  if(url.pathname.endsWith("/Club"))return [club];
  if(url.pathname.endsWith("/Coach"))return [{id:"coach-1",name:"Coach",level:2,trainingSkill:60,recoverySkill:55,medicalSkill:50,weeklySalary:"300"}];
  if(url.pathname.endsWith("/SponsorContract"))return [{id:"s1",partnerName:"Partner",tier:"GOLD",status:"ACTIVE",dailyIncome:"100",startedAt:"2026-11-01T00:00:00Z",endsAt:"2026-12-01T00:00:00Z",createdAt:"2026-11-01T00:00:00Z"}];
  if(url.pathname.endsWith("/AcademyProspect"))return [{id:"p1",recruitmentCost:"500",createdAt:"2026-11-18T00:00:00Z"}];
  if(url.pathname.endsWith("/ClubFinanceEntry"))return [{id:"f1",amount:"200",occurredAt:"2026-11-18T00:00:00Z"}];
  return [{balance:"1000"}];
 });
 const repo=new NodeSupabaseClubManagementRepository(f.client);
 const snapshot=await repo.getOperationsSnapshot("user-1");
 assert.equal(snapshot?.club.id,"club-1");assert.equal(snapshot?.coach?.id,"coach-1");
 assert.equal(snapshot?.sponsors.length,1);assert.equal(snapshot?.prospects.length,1);
 assert.equal(snapshot?.financeEntries.length,1);assert.equal(snapshot?.cashBalance,"1000");
 assert.equal(f.calls.length,6);
});
test("club finance report uses bounded entry query and aggregate RPC",async()=>{
 const f=clientWith((url)=>{
  if(url.pathname.endsWith("/Club"))return [{id:"club-1"}];
  if(url.pathname.endsWith("/rpc/get_club_finance_totals_http"))return [{income:"1200",expenses:"450"}];
  return [{id:"f1",amount:"100",occurredAt:"2026-11-18T00:00:00Z",direction:"CREDIT"}];
 });
 const repo=new NodeSupabaseClubManagementRepository(f.client);
 const since=new Date("2026-11-01T00:00:00Z");
 const report=await repo.getFinanceReport("user-1",since);
 assert.equal(report?.income,"1200");assert.equal(report?.expenses,"450");
 assert.equal(f.calls[2]!.url.pathname,"/rest/v1/rpc/get_club_finance_totals_http");
 const body=JSON.parse(String(f.calls[2]!.init.body));assert.equal(body.p_club_id,"club-1");assert.equal(body.p_since,since.toISOString());
});

test("game dashboard repository uses the established atomic dashboard RPC",async()=>{
 const f=clientWith(()=>({user:{id:"u1",telegramId:"123",username:null,displayName:"Player",createdAt:"2026-01-01T00:00:00Z"},club:null,wallets:[]}));
 const repo=new SupabaseGameDashboardRepository(f.client);
 const result=await repo.getDashboard("u1");
 assert.equal(result.user.id,"u1");assert.deepEqual(result.wallets,[]);
 assert.equal(f.calls[0]!.url.pathname,"/rest/v1/rpc/get_game_dashboard");
 assert.equal(JSON.parse(String(f.calls[0]!.init.body)).p_user_id,"u1");
});
test("wallet read repository returns validated balances ordered by asset",async()=>{
 const f=clientWith(()=>[{asset:"CASH",balance:"1200",version:4,updatedAt:"2026-11-19T10:00:00Z"}]);
 const repo=new NodeSupabaseWalletReadRepository(f.client);
 const result=await repo.list("u1");
 assert.deepEqual(result,[{asset:"CASH",balance:"1200",version:4,updatedAt:"2026-11-19T10:00:00.000Z"}]);
 assert.equal(f.calls[0]!.url.pathname,"/rest/v1/Wallet");
 assert.equal(f.calls[0]!.url.searchParams.get("userId"),"eq.u1");
});

test("club rename uses atomic Supabase RPC and preserves active competition guard", async () => {
 const f=clientWith((url)=>url.pathname.endsWith("/rpc/rename_club_http")
  ? {kind:"LOCKED",activeCompetition:{id:"competition-1",name:"Premier League"}}
  : []);
 const repo=new SupabaseClubLineupRepository(f.client);
 const result=await repo.rename("user-1","Tosan FC");
 assert.deepEqual(result,{kind:"LOCKED",activeCompetition:{id:"competition-1",name:"Premier League"}});
 assert.equal(f.calls[0]!.url.pathname,"/rest/v1/rpc/rename_club_http");
 assert.deepEqual(JSON.parse(String(f.calls[0]!.init.body)),{p_user_id:"user-1",p_name:"Tosan FC"});
});

test("club squad list uses direct Supabase reads and serializes money fields", async () => {
 const f=clientWith((url)=>url.pathname.endsWith("/Club")?[{id:"club-1"}]:[
  {id:"p1",firstName:"A",lastName:"B",nationality:"IR",age:22,position:"ST",overall:80,potential:90,marketValue:"120000",attributes:{pace:80},wage:"1200",contractDays:200,morale:80,fitness:90,origin:"GENERATED",status:"ACTIVE",lineupSlot:9,suspensionMatchesRemaining:0},
 ]);
 const repo=new SupabaseClubLineupRepository(f.client);
 const result=await repo.listPlayers("user-1");
 assert.equal(result.count,1);
 assert.equal(result.players[0]!.marketValue,"120000");
 assert.equal(result.players[0]!.wage,"1200");
 assert.equal(f.calls.length,2);
 assert.equal(f.calls[1]!.url.searchParams.get("status"),"in.(ACTIVE,INJURED,CONTRACT_EXPIRED)");
});

test("public player records are aggregated by the Supabase HTTP RPC", async () => {
 const f=clientWith((url)=>url.pathname.endsWith("/rpc/get_public_player_records_http") ? [{
  playerId:"player-1",playerName:"Test Player",position:"ST",overall:88,clubName:"Test Club",
  appearances:4,goals:3,assists:1,minutesPlayed:360,averageRating:"7.625",value:3,
 }] : []);
 const repo=new NodeSupabasePublicPlayerRecordRepository(f.client);
 const records=await repo.list("goals",10);
 assert.equal(records.length,1);
 assert.equal(records[0]!.playerId,"player-1");
 assert.equal(records[0]!.averageRating,7.625);
 assert.equal(f.calls[0]!.url.pathname,"/rest/v1/rpc/get_public_player_records_http");
 const body=JSON.parse(String(f.calls[0]!.init.body));
 assert.deepEqual(body,{p_metric:"goals",p_limit:10});
});

test("public club logo reads and guarded mutations use Supabase HTTP", async () => {
 const f=clientWith((url)=>url.pathname.endsWith("/rpc/manage_club_logo_http")
  ? {kind:"LOCKED",activeCompetition:{id:"competition-1",name:"League"}}
  : [{logoData:"aGVsbG8=",logoMime:"image/png"}]);
 const repo=new NodeSupabasePublicClubLogoRepository(f.client);
 assert.deepEqual(await repo.getLogo("club-1"),{logoData:"aGVsbG8=",logoMime:"image/png"});
 const result=await repo.manageLogo("user-1","upload","aGVsbG8=","image/png");
 assert.deepEqual(result,{kind:"LOCKED",activeCompetition:{id:"competition-1",name:"League"}});
 assert.equal(f.calls[0]!.url.pathname,"/rest/v1/Club");
 assert.equal(f.calls[1]!.url.pathname,"/rest/v1/rpc/manage_club_logo_http");
 assert.deepEqual(JSON.parse(String(f.calls[1]!.init.body)),{
  p_user_id:"user-1",p_action:"upload",p_logo_data:"aGVsbG8=",p_logo_mime:"image/png",
 });
});

test("event tournament finalization and retry queue use Supabase RPCs", async () => {
 const f=clientWith((url)=>url.pathname.endsWith("/rpc/finalize_event_tournament_http")
  ? {finalized:true,replayed:false,participants:12,awards:18}
  : {candidates:3,finalized:2,failed:1});
 const repo=new SupabaseEventTournamentSettlementRepository(f.client);
 const finalized=await repo.finalize("competition-1","2026-11-19T12:00:00.000Z");
 assert.deepEqual(finalized,{finalized:true,replayed:false,participants:12,awards:18});
 const retried=await repo.processDue("2026-11-19T12:00:00.000Z",10);
 assert.deepEqual(retried,{candidates:3,finalized:2,failed:1});
 assert.equal(f.calls[0]!.url.pathname,"/rest/v1/rpc/finalize_event_tournament_http");
 assert.equal(f.calls[1]!.url.pathname,"/rest/v1/rpc/process_due_event_tournament_finalizations_http");
 assert.deepEqual(JSON.parse(String(f.calls[0]!.init.body)),{p_competition_id:"competition-1",p_now:"2026-11-19T12:00:00.000Z"});
 assert.deepEqual(JSON.parse(String(f.calls[1]!.init.body)),{p_now:"2026-11-19T12:00:00.000Z",p_limit:10});
});
