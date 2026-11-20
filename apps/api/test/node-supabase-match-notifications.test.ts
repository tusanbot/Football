import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseMatchNotificationRepository } from "../src/game/node-supabase-match-notifications.js";

test("match result notification adapter maps statistics, scorers, and claim metadata",async()=>{
 let call:{name:string;args:Record<string,unknown>}|undefined;
 const repository=new NodeSupabaseMatchNotificationRepository({rpc:async(name:string,args:Record<string,unknown>)=>{
  call={name,args};return [{id:"n1",channel:"HOME",telegram_chat_id:"12345",claim_token:"claim",attempt:2,match_id:"m1",
   home_score:2,away_score:1,completed_at:"2026-11-20T10:00:00Z",home_club_id:"h",away_club_id:"a",home_club_name:"Home FC",away_club_name:"Away FC",
   performances:[{club_id:"h",goals:2,shots:5,passes:100,tackles:4,player_name:"Scorer"},{club_id:"a",goals:0,shots:3,passes:80,tackles:6,player_name:"Keeper"}]}];
 }} as never);
 const result=await repository.claimResults(10);
 assert.equal(call?.name,"claim_due_match_result_notifications_node_http");assert.equal(call?.args.p_limit,10);
 assert.deepEqual(result[0]?.match.statistics.home,{shots:5,passes:100,tackles:4});
 assert.deepEqual(result[0]?.match.scorers,[{player:"Scorer",goals:2}]);
});
test("lifecycle and tactical checkpoint adapters validate the RPC row shapes",async()=>{
 const repository=new NodeSupabaseMatchNotificationRepository({rpc:async(name:string)=>name.includes("lifecycle")?
  [{id:"l1",channel:"HOME",telegram_chat_id:"123",claim_token:"c",attempt:1,kind:"GOAL",minute:30,home_score:1,away_score:0,payload:{goal:true},match_id:"m",home_club_name:"H",away_club_name:"A"}]:
  [{checkpoint_id:"cp",match_id:"m",checkpoint_key:"minute-45",minute:45,deadline_at:"2026-11-20T10:00:00Z",club_id:"h",club_name:"Home",opponent_name:"Away",telegram_user_id:"123",side:"HOME",attempt:1}],
 } as never);
 assert.equal((await repository.claimLifecycle(5))[0]?.payload?.goal,true);
 assert.equal((await repository.claimCheckpoints(5,"cp"))[0]?.side,"HOME");
});
test("notification completion and checkpoint acknowledgement use their atomic RPCs",async()=>{
 const calls:string[]=[];
 const repository=new NodeSupabaseMatchNotificationRepository({rpc:async(name:string)=>{calls.push(name);return true;}} as never);
 assert.equal(await repository.complete("RESULT","n","claim",true,null,30),true);
 assert.equal(await repository.acknowledgeCheckpoint("cp","AWAY",true,null),true);
 assert.deepEqual(calls,["complete_match_notification_delivery","ack_match_checkpoint_notification_node_http"]);
});
