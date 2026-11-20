import assert from "node:assert/strict";
import test from "node:test";
import { SupabasePlayerDevelopmentRepository } from "../src/players/node-supabase-player-development.js";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { NodeSupabaseClubEconomyRepository } from "../src/game/node-supabase-club-economy.js";

function fakeDb() {
 const calls:Array<{kind:"select"|"rpc";name:string;args:Record<string,unknown>}>= [];
 const db={
  select:async <T>(table:string,query:Record<string,string>)=>{
   calls.push({kind:"select",name:table,args:query});
   if(table==="Club")return [{id:"club-1",name:"Test FC",trainingGroundLevel:2,lastDailyTickAt:"2026-11-18T00:00:00.000Z",lastPayrollAt:"2026-11-18T00:00:00.000Z",wageArrears:"0"}] as T;
   if(table==="Player")return [{id:"player-1",firstName:"Test",lastName:"Player",age:22,ageDays:364,position:"ST",overall:70,potential:80,attributes:{pace:70,shooting:70,passing:60,dribbling:70,defending:30,physical:65,goalkeeping:20},wage:"100",contractDays:30,morale:80,fitness:70,status:"ACTIVE",injuryUntil:null,lineupSlot:2,trainingFocus:"BALANCED",lastTrainedAt:null}] as T;
   if(table==="Coach")return [{id:"coach-1",name:"Coach",level:1,trainingSkill:40,recoverySkill:30,medicalSkill:25,weeklySalary:"50"}] as T;
   if(table==="Wallet")return [{id:"wallet-1",balance:"10000",version:3}] as T;
   return [] as T;
  },
  rpc:async <T>(name:string,args:Record<string,unknown>)=>{calls.push({kind:"rpc",name,args});return {ok:true} as T;}
 };
 return {db:db as unknown as SupabaseHttpClient,calls};
}

test("player daily settlement prepares expected-state updates and invokes atomic RPC",async()=>{
 const f=fakeDb();const repo=new SupabasePlayerDevelopmentRepository(f.db);
 const result=await repo.settle("user-1",new Date("2026-11-19T12:00:00.000Z"));
 assert.equal(result.elapsedDays,1);assert.equal(result.gameDate,"2026-11-19");
 const call=f.calls.find(x=>x.kind==="rpc");assert.ok(call);assert.equal(call!.name,"settle_player_daily_state_http");
 assert.equal(call!.args.p_user_id,"user-1");assert.equal(call!.args.p_club_id,"club-1");assert.equal(call!.args.p_elapsed_days,1);
 const updates=call!.args.p_updates as Array<Record<string,unknown>>;assert.equal(updates.length,1);assert.equal(updates[0]!.id,"player-1");assert.equal(updates[0]!.expectedAge,22);
});

test("player daily settlement skips RPC when already settled for UTC game day",async()=>{
 const f=fakeDb();f.db.select=async <T>(table:string)=>table==="Club"?[{id:"club-1",name:"Test FC",trainingGroundLevel:2,lastDailyTickAt:"2026-11-19T00:00:00.000Z",lastPayrollAt:"2026-11-19T00:00:00.000Z",wageArrears:"0"}] as T:[] as T;
 const repo=new SupabasePlayerDevelopmentRepository(f.db);const result=await repo.settle("user-1",new Date("2026-11-19T12:00:00.000Z"));
 assert.equal(result.elapsedDays,0);assert.equal(f.calls.some(x=>x.kind==="rpc"),false);
});

test("club economy settlement calls atomic RPC and validates decimal amounts",async()=>{
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];const fake={rpc:async <T>(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {elapsedDays:2,sponsorIncome:"500",operatingCost:"300",paid:"300",arrears:"0"} as T;}};
 const repo=new NodeSupabaseClubEconomyRepository(fake as unknown as SupabaseHttpClient);
 const result=await repo.settle("user-1",new Date("2026-11-19T12:00:00.000Z"));
 assert.equal(calls[0]!.name,"settle_club_economy");assert.equal(calls[0]!.args.p_user_id,"user-1");assert.equal(result.sponsorIncome,"500");
 const invalid={rpc:async <T>()=>({elapsedDays:1,sponsorIncome:500,operatingCost:"1",paid:"1",arrears:"0"}) as T};
 await assert.rejects(new NodeSupabaseClubEconomyRepository(invalid as unknown as SupabaseHttpClient).settle("user-1",new Date()),/SUPABASE_CLUB_ECONOMY_SETTLEMENT_INVALID_RESPONSE/);
});
