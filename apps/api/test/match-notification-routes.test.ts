import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { MatchNotificationPort, MatchCheckpointNotification, MatchLifecycleNotification, MatchResultNotification } from "../src/game/match-notification-routes.js";

function fixture() {
 const checkpointClaims=new Map<string,string>();
 const port:MatchNotificationPort={
  async claimResults(_limit):Promise<MatchResultNotification[]>{return [{id:"result-1",channel:"HOME",telegramChatId:"12345",claimToken:randomUUID(),attempt:1,
   match:{id:"match-1",homeClub:"Home FC",awayClub:"Away FC",homeScore:2,awayScore:1,completedAt:"2026-11-20T10:00:00.000Z",
    statistics:{home:{shots:5,passes:200,tackles:10},away:{shots:3,passes:150,tackles:8}},scorers:[{player:"A Player",goals:2}]}}];},
  async claimLifecycle(_limit):Promise<MatchLifecycleNotification[]>{return [{id:"life-1",channel:"HOME",telegramChatId:"12345",claimToken:randomUUID(),attempt:2,
   kind:"GOAL",minute:45,homeScore:1,awayScore:0,payload:{player:"A"},match:{id:"match-1",homeClub:"Home FC",awayClub:"Away FC"}}];},
  async complete(_type,id,token,delivered,_error,_retry){return id==="result-1"&&token.length>0&&delivered;},
  async claimCheckpoints(_limit,checkpointId):Promise<MatchCheckpointNotification[]>{if(checkpointId==="cp-1"&&!checkpointClaims.has("HOME")){
   checkpointClaims.set("HOME","claimed");return [{checkpointId:"cp-1",matchId:"match-1",checkpointKey:"minute-45",minute:45,deadlineAt:"2026-11-20T10:01:00Z",
    clubId:"home",clubName:"Home FC",opponentName:"Away FC",telegramUserId:"12345",side:"HOME",attempt:1,claimToken:randomUUID()}];}return [];},
  async acknowledgeCheckpoint(id,side,claimToken,delivered){if(id!=="cp-1"||!claimToken||!checkpointClaims.has(side))return false;if(delivered)checkpointClaims.set(side,"delivered");return true;},
 };
 return port;
}
test("match notification endpoints require the shared Bot secret",async t=>{
 const previous=process.env.BOT_API_SECRET;process.env.BOT_API_SECRET="test-match-notification-secret";
 const app=buildApp({logger:false,matchNotificationPort:fixture()});await app.ready();
 t.after(async()=>{await app.close();if(previous===undefined)delete process.env.BOT_API_SECRET;else process.env.BOT_API_SECRET=previous;});
 const urls=["/v1/bot/match-checkpoints/claim","/v1/bot/match-checkpoints/ack","/v1/bot/match-results/claim","/v1/bot/match-results/ack","/v1/bot/match-lifecycle/claim","/v1/bot/match-lifecycle/ack"];
 const responses=await Promise.all(urls.map(url=>app.inject({method:"POST",url,payload:{limit:5}})));
 assert.deepEqual(responses.map(x=>x.statusCode),[401,401,401,401,401,401]);
});
test("match result and lifecycle notification routes use repository claim and acknowledgement",async t=>{
 const previous=process.env.BOT_API_SECRET;process.env.BOT_API_SECRET="test-match-notification-secret";
 const app=buildApp({logger:false,matchNotificationPort:fixture()});await app.ready();
 t.after(async()=>{await app.close();if(previous===undefined)delete process.env.BOT_API_SECRET;else process.env.BOT_API_SECRET=previous;});
 const headers={"x-football-bot-secret":"test-match-notification-secret"};
 const result=await app.inject({method:"POST",url:"/v1/bot/match-results/claim",headers,payload:{limit:5}});
 assert.equal(result.statusCode,200);assert.equal(result.json().notifications[0].match.statistics.home.shots,5);
 const resultAck=await app.inject({method:"POST",url:"/v1/bot/match-results/ack",headers,payload:{id:"result-1",claimToken:randomUUID(),delivered:true}});
 assert.equal(resultAck.statusCode,200);
 const lifecycle=await app.inject({method:"POST",url:"/v1/bot/match-lifecycle/claim",headers,payload:{limit:5}});
 assert.equal(lifecycle.statusCode,200);assert.equal(lifecycle.json().notifications[0].kind,"GOAL");
 const invalid=await app.inject({method:"POST",url:"/v1/bot/match-lifecycle/ack",headers,payload:{id:"life-1",claimToken:"invalid",delivered:true}});
 assert.equal(invalid.statusCode,400);
});
test("tactical checkpoint notifications are claimed and acknowledged through the repository",async t=>{
 const previous=process.env.BOT_API_SECRET;process.env.BOT_API_SECRET="test-match-notification-secret";
 const app=buildApp({logger:false,matchNotificationPort:fixture()});await app.ready();
 t.after(async()=>{await app.close();if(previous===undefined)delete process.env.BOT_API_SECRET;else process.env.BOT_API_SECRET=previous;});
 const headers={"x-football-bot-secret":"test-match-notification-secret"};
 const claim=await app.inject({method:"POST",url:"/v1/bot/match-checkpoints/claim",headers,payload:{limit:10,checkpointId:"cp-1"}});
 assert.equal(claim.statusCode,200);assert.equal(claim.json().notifications[0].side,"HOME");
 const ack=await app.inject({method:"POST",url:"/v1/bot/match-checkpoints/ack",headers,payload:{checkpointId:"cp-1",side:"HOME",claimToken:randomUUID(),delivered:true}});
 assert.equal(ack.statusCode,200);assert.deepEqual((await app.inject({method:"POST",url:"/v1/bot/match-checkpoints/claim",headers,payload:{limit:10,checkpointId:"cp-1"}})).json(),{notifications:[]});
});
