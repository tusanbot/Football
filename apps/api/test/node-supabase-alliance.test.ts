import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseAllianceRepository } from "../src/groups/node-supabase-alliance.js";
import { AllianceServiceError } from "../src/groups/alliance-service.js";
import { NodeSupabaseTelegramUserLookupRepository } from "../src/auth/node-supabase-telegram-user-lookup.js";

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

test("Node alliance repository preserves the real admin actor for atomic admin season RPCs", async () => {
  const previous=globalThis.fetch;
  const calls:Array<{url:string;body:Record<string,unknown>}>=[];
  globalThis.fetch=(async(input,init)=>{
    calls.push({url:String(input),body:JSON.parse(String(init?.body)) as Record<string,unknown>});
    return new Response(JSON.stringify({season:{id:"season-1",number:2,startsAt:"2026-11-19T00:00:00.000Z",endsAt:"2026-11-26T00:00:00.000Z"},replayed:false}),{status:200});
  }) as typeof fetch;
  try {
    const repo=new NodeSupabaseAllianceRepository("https://example.supabase.co","node-alliance-service-role-test-key");
    await repo.adminStartAllianceSeason({actorTelegramId:"987654321",allianceId:"alliance-1",durationDays:7,idempotencyKey:"admin-start-idempotency"});
    await repo.adminCloseAllianceSeason({actorTelegramId:"987654321",seasonId:"season-1",idempotencyKey:"admin-close-idempotency"});
    await repo.adminReviewAllianceSeason({actorTelegramId:"987654321",seasonId:"season-1",decision:"APPROVE",idempotencyKey:"admin-review-idempotency"});
    assert.equal(calls[0]!.url.endsWith("/admin_start_alliance_season_http"),true);
    assert.deepEqual(calls[0]!.body,{p_actor_telegram_id:"987654321",p_alliance_id:"alliance-1",p_duration_days:7,p_idempotency_key:"admin-start-idempotency",p_reason:null});
    assert.equal(calls[1]!.url.endsWith("/admin_close_alliance_season_http"),true);
    assert.deepEqual(calls[1]!.body,{p_actor_telegram_id:"987654321",p_season_id:"season-1",p_idempotency_key:"admin-close-idempotency",p_reason:null});
    assert.equal(calls[2]!.url.endsWith("/admin_review_alliance_season_http"),true);
    assert.deepEqual(calls[2]!.body,{p_actor_telegram_id:"987654321",p_season_id:"season-1",p_decision:"APPROVE",p_idempotency_key:"admin-review-idempotency",p_reason:null});
  } finally { globalThis.fetch=previous; }
});

test("Node Telegram user lookup resolves active users through server-authenticated Supabase RPC", async () => {
  const previous=globalThis.fetch;
  let call:{url:string;headers:Headers;body:Record<string,unknown>}|null=null;
  globalThis.fetch=(async(input,init)=>{
    call={url:String(input),headers:new Headers(init?.headers),body:JSON.parse(String(init?.body)) as Record<string,unknown>};
    return new Response(JSON.stringify({id:"user-1",telegramId:"123456",username:null,displayName:null,createdAt:"2026-11-19T00:00:00.000Z"}),{status:200});
  }) as typeof fetch;
  try {
    const repo=new NodeSupabaseTelegramUserLookupRepository("https://example.supabase.co","node-user-lookup-service-role-test-key");
    const now=new Date("2026-11-19T12:00:00.000Z");
    const user=await repo.loadActiveUser("123456",now);
    assert.deepEqual(user,{id:"user-1",telegramId:"123456",username:null,displayName:"",createdAt:"2026-11-19T00:00:00.000Z"});
    assert.equal(call?.url,"https://example.supabase.co/rest/v1/rpc/resolve_telegram_user");
    assert.equal(call?.headers.get("authorization"),"Bearer node-user-lookup-service-role-test-key");
    assert.deepEqual(call?.body,{p_telegram_id:"123456",p_now:now.toISOString()});
  } finally { globalThis.fetch=previous; }
});

test("Node Telegram user lookup returns null for missing accounts and rejects unsafe origins", async () => {
  const previous=globalThis.fetch;
  globalThis.fetch=(async()=>new Response("null",{status:200})) as typeof fetch;
  try {
    const repo=new NodeSupabaseTelegramUserLookupRepository("https://example.supabase.co","node-user-lookup-service-role-test-key");
    assert.equal(await repo.loadActiveUser("123456"),null);
    assert.throws(()=>new NodeSupabaseTelegramUserLookupRepository("http://example.supabase.co","node-user-lookup-service-role-test-key"));
    assert.throws(()=>new NodeSupabaseTelegramUserLookupRepository("https://attacker.example","node-user-lookup-service-role-test-key"));
  } finally { globalThis.fetch=previous; }
});
