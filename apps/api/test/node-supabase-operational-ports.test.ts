import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient, SupabaseHttpError } from "../src/node-supabase-http.js";
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
