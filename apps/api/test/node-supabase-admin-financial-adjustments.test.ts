import test from "node:test";
import assert from "node:assert/strict";
import { NodeSupabaseAdminFinancialAdjustmentsRepository } from "../src/node-supabase-admin-financial-adjustments.js";
import type { SupabaseHttpClient } from "../src/node-supabase-http.js";
test("admin wallet adjustment calls the atomic Supabase RPC",async()=>{
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return{ok:true,targetType:"wallet",targetId:"user-1",replay:false,balance:"150",ledgerId:"ledger-1"};}} as unknown as SupabaseHttpClient;
 const repo=new NodeSupabaseAdminFinancialAdjustmentsRepository(client);
 assert.deepEqual(await repo.execute({action:"adjust-wallet",targetId:"user-1",amount:"50",asset:"CASH",actorTelegramId:"123456",idempotencyKey:"admin-wallet-key-01",reason:"Manual credit"}),{ok:true,targetType:"wallet",targetId:"user-1",replay:false,balance:"150",ledgerId:"ledger-1"});
 assert.equal(calls[0]?.name,"admin_financial_adjustment_http");assert.equal(calls[0]?.args.p_asset,"CASH");
});
test("admin group point adjustment calls the same atomic RPC without an asset",async()=>{
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];const client={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return{ok:true,targetType:"group-points",targetId:"group-1",replay:false,points:"125",ledgerId:"ledger-2"};}} as unknown as SupabaseHttpClient;
 const repo=new NodeSupabaseAdminFinancialAdjustmentsRepository(client);
 assert.equal((await repo.execute({action:"adjust-group-points",targetId:"group-1",amount:"25",actorTelegramId:"123456",idempotencyKey:"admin-group-key-01",reason:"Manual points"})).points,"125");
 assert.equal(calls[0]?.args.p_asset,null);
});
test("admin financial adjustment repository rejects invalid inputs and malformed responses",async()=>{
 const client={rpc:async()=>({ok:false})} as unknown as SupabaseHttpClient;const repo=new NodeSupabaseAdminFinancialAdjustmentsRepository(client);
 await assert.rejects(repo.execute({action:"adjust-wallet",targetId:"user-1",amount:"0",asset:"CASH",actorTelegramId:"123456",idempotencyKey:"admin-wallet-key-02",reason:"Invalid"}),/INVALID_ADMIN_FINANCIAL_ADJUSTMENT/);
 await assert.rejects(repo.execute({action:"adjust-group-points",targetId:"group-1",amount:"5",actorTelegramId:"123456",idempotencyKey:"admin-group-key-02",reason:"Manual points"}),/SUPABASE_ADMIN_FINANCIAL_ADJUSTMENT_INVALID_RESPONSE/);
});
