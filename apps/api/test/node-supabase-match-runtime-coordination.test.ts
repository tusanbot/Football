import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { SupabaseMatchRuntimeLeaseRepository } from "../src/game/node-supabase-match-runtime-lease.js";
import { SupabaseMatchRuntimeSnapshotRepository } from "../src/game/node-supabase-match-runtime-snapshot.js";
import { SupabaseMatchRuntimeEnqueueRepository } from "../src/game/node-supabase-match-runtime-enqueue.js";
import { SupabaseMatchRuntimeAdvanceRepository } from "../src/game/node-supabase-match-runtime-advance.js";
import { SupabaseMatchRuntimeCheckpointRepository } from "../src/game/node-supabase-match-runtime-checkpoint.js";

const url="https://example.supabase.co", key="match-runtime-coordination-service-role-key";
function stubFetch(payloads:unknown[],status=200){
 const original=globalThis.fetch;
 const calls:Array<{url:string;headers:Headers;body:Record<string,unknown>}>=[];
 globalThis.fetch=(async(input,init)=>{
  calls.push({url:String(input),headers:new Headers(init?.headers),body:JSON.parse(String(init?.body??"{}")) as Record<string,unknown>});
  const payload=payloads.shift();
  return new Response(JSON.stringify(payload??null),{status,headers:{"content-type":"application/json"}});
 }) as typeof fetch;
 return {calls,restore:()=>{globalThis.fetch=original;}};
}
function client(){return new SupabaseHttpClient({url,serviceRoleKey:key});}

test("runtime lease reads coordinator schedule, claims leases and releases by token through authenticated RPCs",async()=>{
 const schedule={next_alarm:"2026-11-20T10:05:00.000Z",has_due_runtime:true,has_due_fixture:false,has_due_notifications:true,has_pending_tournament_finalization:false,has_pending_promotion_work:true};
 const stub=stubFetch([[schedule],[{runtime_id:"runtime-1",lease_token:"lease-1",lease_expires_at:"2026-11-20T10:01:00.000Z"}],[{released:true}]]);
 try{
  const repo=new SupabaseMatchRuntimeLeaseRepository(client());
  const read=await repo.getSchedule();
  assert.equal(read.nextAlarm?.toISOString(),schedule.next_alarm);
  assert.equal(read.hasDueRuntime,true);
  assert.equal(read.hasPendingPromotionWork,true);
  const claims=await repo.claim({workerId:"worker-1",now:"2026-11-20T10:00:00.000Z",leaseMs:60_000,limit:4});
  assert.deepEqual(claims,[{runtime:{id:"runtime-1"},lease:{owner:"worker-1",token:"lease-1",expiresAt:new Date("2026-11-20T10:01:00.000Z")}}]);
  assert.equal(await repo.release({runtimeId:"runtime-1",leaseToken:"lease-1",nextActionAt:null,lastError:null}),true);
  assert.deepEqual(stub.calls.map(x=>new URL(x.url).pathname),[
   "/rest/v1/rpc/get_match_coordinator_schedule",
   "/rest/v1/rpc/claim_due_match_runtimes",
   "/rest/v1/rpc/release_match_runtime_lease",
  ]);
  assert.equal(stub.calls.every(x=>x.headers.get("authorization")==="Bearer "+key),true);
  assert.deepEqual(stub.calls[1]!.body,{p_worker_id:"worker-1",p_now:"2026-11-20T10:00:00.000Z",p_lease_ms:60_000,p_limit:4});
  assert.deepEqual(stub.calls[2]!.body,{p_runtime_id:"runtime-1",p_lease_token:"lease-1",p_next_action_at:null,p_last_error:null});
 }finally{stub.restore();}
});

test("runtime lease repository rejects malformed schedule, claim and release responses",async()=>{
 const badSchedule=stubFetch([[{has_due_runtime:true}]]);
 try{await assert.rejects(new SupabaseMatchRuntimeLeaseRepository(client()).getSchedule(),/SUPABASE_MATCH_SCHEDULE_INVALID_RESPONSE/);}finally{badSchedule.restore();}
 const badClaim=stubFetch([[{runtime_id:"runtime-1",lease_token:"",lease_expires_at:"not-a-date"}]]);
 try{await assert.rejects(new SupabaseMatchRuntimeLeaseRepository(client()).claim({workerId:"w",now:"2026-11-20T10:00:00.000Z",leaseMs:1000,limit:1}),/SUPABASE_MATCH_RUNTIME_CLAIM_INVALID_RESPONSE/);}finally{badClaim.restore();}
 const badRelease=stubFetch([[]]);
 try{await assert.rejects(new SupabaseMatchRuntimeLeaseRepository(client()).release({runtimeId:"r",leaseToken:"t",nextActionAt:null,lastError:null}),/SUPABASE_MATCH_RUNTIME_RELEASE_INVALID_RESPONSE/);}finally{badRelease.restore();}
});

test("runtime snapshot validates shape and normalizes dates and ticket balances",async()=>{
 const club=(id:string)=>({id,name:id,formation:"4-3-3",mentality:"BALANCED",pressing:"NORMAL",tempo:"NORMAL",passingStyle:"MIXED",
  stadiumLevel:3,ticketPrice:"250",reputation:100,owner:{id:"owner-"+id},coach:null,
  players:[{id:"player-"+id,injuryUntil:"2026-11-21T10:00:00.000Z"}]});
 const payload={id:"runtime-1",matchId:"match-1",stateVersion:3,currentMinute:45,status:"RUNNING",
  nextActionAt:"2026-11-20T10:05:00.000Z",startedAt:"2026-11-20T10:00:00.000Z",completedAt:null,leaseExpiresAt:null,
  match:{id:"match-1",seed:"seed-1",status:"IN_PROGRESS",scheduledAt:"2026-11-20T10:00:00.000Z",startedAt:null,completedAt:null,
   homeClub:club("home"),awayClub:club("away")}};
 const stub=stubFetch([payload]);
 try{
  const result=await new SupabaseMatchRuntimeSnapshotRepository(client()).get("runtime-1") as Record<string,any>;
  assert.equal(result.id,"runtime-1");
  assert.equal(result.nextActionAt.toISOString(),"2026-11-20T10:05:00.000Z");
  assert.equal(result.match.scheduledAt.toISOString(),"2026-11-20T10:00:00.000Z");
  assert.equal(result.match.homeClub.ticketPrice,250n);
  assert.equal(result.match.awayClub.players[0].injuryUntil.toISOString(),"2026-11-21T10:00:00.000Z");
  assert.equal(stub.calls[0]!.url,url+"/rest/v1/rpc/get_match_runtime_snapshot_http");
  assert.deepEqual(stub.calls[0]!.body,{p_runtime_id:"runtime-1"});
 }finally{stub.restore();}
 const malformed=stubFetch([{id:"runtime-1",matchId:"match-1"}]);
 try{await assert.rejects(new SupabaseMatchRuntimeSnapshotRepository(client()).get("runtime-1"),/SUPABASE_MATCH_RUNTIME_SNAPSHOT_INVALID_RESPONSE/);}finally{malformed.restore();}
});

function clubSnapshot(id:string){
 const players=Array.from({length:11},(_,i)=>({id:id+"-p"+i,firstName:"Player",lastName:String(i),
  position:i===0?"GK":"ST",overall:70,lineupSlot:i,morale:80,fitness:90,attributes:{pace:70},suspensionMatchesRemaining:0}));
 return {id,ownerId:"owner-"+id,name:id,formation:"4-3-3",mentality:"BALANCED",pressing:"NORMAL",tempo:"NORMAL",passingStyle:"MIXED",
  stadiumLevel:3,ticketPrice:"250",reputation:100,matchFallbackPlan:null,coachMedicalSkill:5,players};
}
test("runtime enqueue snapshots valid due fixtures, reports invalid squads and bounds requested limit",async()=>{
 const stub=stubFetch([[{match_id:"match-1",scheduled_at:"2026-11-20T10:00:00.000Z",home_club:clubSnapshot("home"),away_club:clubSnapshot("away")},
  {match_id:"match-invalid",scheduled_at:"2026-11-20T10:00:00.000Z",home_club:{...clubSnapshot("bad"),players:[]},away_club:clubSnapshot("away-2")}],[1]]);
 try{
  const result=await new SupabaseMatchRuntimeEnqueueRepository(client()).enqueue("2026-11-20T10:00:00.000Z",500);
  assert.deepEqual(result,{enqueued:1,invalidFixtures:[{id:"match-invalid",ownerId:"owner-bad"}]});
  assert.equal(stub.calls[0]!.url,url+"/rest/v1/rpc/get_due_match_runtime_fixtures");
  assert.deepEqual(stub.calls[0]!.body,{p_now:"2026-11-20T10:00:00.000Z",p_limit:100});
  assert.equal(stub.calls[1]!.url,url+"/rest/v1/rpc/enqueue_match_runtime_snapshots");
  const rows=stub.calls[1]!.body.p_rows as Array<Record<string,unknown>>;
  assert.equal(rows.length,1);
  const kickoff=rows[0]!.kickoff_snapshot as Record<string,any>;
  assert.equal(kickoff.home.players.length,11);
  assert.equal(kickoff.home.players[0].position,"GK");
  assert.equal(typeof kickoff.home.ticketPrice,"string");
 }finally{stub.restore();}
});

test("runtime first-half advance sends lease, state version, events and checkpoint timing in one RPC",async()=>{
 const stub=stubFetch([true]);
 try{
  const repo=new SupabaseMatchRuntimeAdvanceRepository(client());
  assert.equal(await repo.advanceFirstHalf({runtimeId:"runtime-1",expectedStateVersion:4,leaseToken:"lease-1",
   simulationState:{minute:45},startedAt:"2026-11-20T10:00:00.000Z",checkpointAt:"2026-11-20T10:00:45.000Z",
   decisionDeadlineAt:"2026-11-20T10:01:00.000Z",events:[{eventKey:"goal-1",kind:"GOAL",minute:12,homeScore:1,awayScore:0,payload:{playerId:"p1"},availableAt:"2026-11-20T10:00:12.000Z"}]}),true);
  assert.equal(stub.calls[0]!.url,url+"/rest/v1/rpc/advance_match_runtime_first_half");
  assert.deepEqual(stub.calls[0]!.body,{p_runtime_id:"runtime-1",p_expected_state_version:4,p_lease_token:"lease-1",
   p_simulation_state:{minute:45},p_started_at:"2026-11-20T10:00:00.000Z",p_checkpoint_at:"2026-11-20T10:00:45.000Z",
   p_decision_deadline_at:"2026-11-20T10:01:00.000Z",p_events:[{event_key:"goal-1",kind:"GOAL",minute:12,home_score:1,away_score:0,payload:{playerId:"p1"},available_at:"2026-11-20T10:00:12.000Z"}]});
 }finally{stub.restore();}
 const rejected=stubFetch([false]);
 try{await assert.rejects(new SupabaseMatchRuntimeAdvanceRepository(client()).advanceFirstHalf({runtimeId:"r",expectedStateVersion:1,leaseToken:"t",simulationState:{},startedAt:"2026-11-20T10:00:00.000Z",checkpointAt:"2026-11-20T10:00:45.000Z",decisionDeadlineAt:"2026-11-20T10:01:00.000Z",events:[]}),/SUPABASE_MATCH_RUNTIME_FIRST_HALF_REJECTED/);}finally{rejected.restore();}
});

test("checkpoint repository covers lifecycle enqueue, decisions, open checkpoint reads and atomic resolution",async()=>{
 const decision={decision:{id:"decision-1",checkpointId:"checkpoint-1",clubId:"club-1",submittedByUserId:"user-1",idempotencyKey:"decision-key-123",instruction:{substitution:"p1"},submittedAt:"2026-11-20T10:00:00.000Z"},replayed:false};
 const checkpoint={checkpoint:{id:"checkpoint-1",checkpointKey:"half-time-v1",kind:"HALF_TIME",minute:45,status:"OPEN",openedAt:"2026-11-20T10:00:00.000Z",decisionDeadlineAt:"2026-11-20T10:01:00.000Z",nextSegmentAt:"2026-11-20T10:01:00.000Z"},decisions:[]};
 const stub=stubFetch([2,decision,checkpoint,true]);
 try{
  const repo=new SupabaseMatchRuntimeCheckpointRepository(client());
  assert.equal(await repo.enqueueLifecycleEvents("match-1",[{eventKey:"kickoff",kind:"KICKOFF",minute:0,homeScore:0,awayScore:0,payload:{},availableAt:"2026-11-20T10:00:00.000Z"}]),2);
  assert.deepEqual(await repo.submitDecision({userId:"user-1",matchId:"match-1",checkpointKey:"half-time-v1",idempotencyKey:"decision-key-123",instruction:{substitution:"p1"},submittedAt:"2026-11-20T10:00:00.000Z"}),decision);
  assert.deepEqual(await repo.getOpenCheckpoint("match-1"),checkpoint);
  assert.equal(await repo.resolveCheckpoint({runtimeId:"runtime-1",checkpointId:"checkpoint-1",expectedStateVersion:5,leaseToken:"lease-1",
   resolution:{decisionId:"decision-1"},nextMinute:60,simulationState:{minute:60},nextActionAt:"2026-11-20T10:02:00.000Z",
   events:[],nextCheckpoint:{checkpointKey:"minute-60-v1",kind:"MINUTE_60",minute:60,openedAt:"2026-11-20T10:01:00.000Z",
    decisionDeadlineAt:"2026-11-20T10:02:00.000Z",nextSegmentAt:"2026-11-20T10:02:00.000Z"}}),true);
  assert.deepEqual(stub.calls.map(x=>new URL(x.url).pathname),[
   "/rest/v1/rpc/enqueue_match_lifecycle_events",
   "/rest/v1/rpc/submit_match_runtime_tactical_decision",
   "/rest/v1/rpc/get_match_runtime_open_checkpoint",
   "/rest/v1/rpc/resolve_match_runtime_checkpoint",
  ]);
  assert.deepEqual(stub.calls[3]!.body.p_next_checkpoint,{checkpoint_key:"minute-60-v1",kind:"MINUTE_60",minute:60,
   opened_at:"2026-11-20T10:01:00.000Z",decision_deadline_at:"2026-11-20T10:02:00.000Z",next_segment_at:"2026-11-20T10:02:00.000Z"});
 }finally{stub.restore();}
});
