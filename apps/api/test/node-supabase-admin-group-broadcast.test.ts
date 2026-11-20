import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseAdminGroupBroadcastRepository } from "../src/node-supabase-admin-group-broadcast.js";
test("admin group broadcast adapter maps claim payload and attempts",async()=>{
 let call:{name:string;args:Record<string,unknown>}|undefined;
 const repo=new NodeSupabaseAdminGroupBroadcastRepository({rpc:async(name:string,args:Record<string,unknown>)=>{
  call={name,args};return [{id:"delivery-1",telegram_group_id:"-100123",message:"Hello",claim_token:"token",attempt:3}];
 }} as never);
 assert.deepEqual(await repo.claim(10),[{id:"delivery-1",telegramGroupId:"-100123",message:"Hello",claimToken:"token",attempt:3}]);
 assert.equal(call?.name,"claim_due_admin_group_broadcasts_http");assert.equal(call?.args.p_limit,10);
});
test("admin group broadcast adapter rejects stale claims and maps retry state",async()=>{
 const repo=new NodeSupabaseAdminGroupBroadcastRepository({rpc:async(name:string)=>name.startsWith("complete")?false:[{rescheduled:true,attempts:2}]} as never);
 assert.equal(await repo.complete("d","token"),false);
 assert.deepEqual(await repo.fail("d","token","temporary"),{rescheduled:true,attempts:2});
});
