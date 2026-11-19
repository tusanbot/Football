import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseAllianceRepository } from "../src/groups/node-supabase-alliance.js";
import { AllianceServiceError } from "../src/groups/alliance-service.js";

test("Node alliance repository sends server-authenticated HTTPS RPC calls", async () => {
  const previous = globalThis.fetch;
  const calls: Array<{url:string;headers:Headers;body:Record<string,unknown>}> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({url:String(input),headers:new Headers(init?.headers),body:JSON.parse(String(init?.body)) as Record<string,unknown>});
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json"}});
  }) as typeof fetch;
  try {
    const repo = new NodeSupabaseAllianceRepository("https://example.supabase.co","node-alliance-service-role-test-key");
    await repo.createAlliance({telegramUserId:"123",telegramGroupId:"-100123",name:"Test Alliance",description:"",idempotencyKey:"alliance-idempotency-1"});
    assert.equal(calls[0]!.url,"https://example.supabase.co/rest/v1/rpc/create_alliance_http");
    assert.equal(calls[0]!.headers.get("authorization"),"Bearer node-alliance-service-role-test-key");
    assert.deepEqual(calls[0]!.body,{p_telegram_user_id:"123",p_telegram_group_id:"-100123",p_name:"Test Alliance",p_description:"",p_idempotency_key:"alliance-idempotency-1"});
    await repo.contributeAllianceTreasury({telegramUserId:"123",telegramGroupId:"-100123",amount:"250",idempotencyKey:"contribution-idempotency"});
    assert.equal(calls[1]!.url.endsWith("/contribute_alliance_treasury_http"),true);
    assert.equal(calls[1]!.body.p_amount,"250");
    assert.equal(calls[1]!.body.p_idempotency_key,"contribution-idempotency");
  } finally { globalThis.fetch=previous; }
});

test("Node alliance repository maps RPC business errors to AllianceServiceError", async () => {
  const previous=globalThis.fetch;
  globalThis.fetch=(async()=>new Response(JSON.stringify({error:"GROUP_MANAGER_REQUIRED"}),{status:200})) as typeof fetch;
  try {
    const repo=new NodeSupabaseAllianceRepository("https://example.supabase.co","node-alliance-service-role-test-key");
    await assert.rejects(repo.createAlliance({telegramUserId:"123",telegramGroupId:"-100123",name:"Test Alliance",idempotencyKey:"alliance-idempotency-1"}),
      (error:unknown)=>error instanceof AllianceServiceError && error.code==="GROUP_MANAGER_REQUIRED");
  } finally { globalThis.fetch=previous; }
});

test("Node alliance repository rejects unsafe origins and credentials",()=>{
  assert.throws(()=>new NodeSupabaseAllianceRepository("http://example.supabase.co","node-alliance-service-role-test-key"));
  assert.throws(()=>new NodeSupabaseAllianceRepository("https://attacker.example","node-alliance-service-role-test-key"));
  assert.throws(()=>new NodeSupabaseAllianceRepository("https://example.supabase.co","short"));
});
