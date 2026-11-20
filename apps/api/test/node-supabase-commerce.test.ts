import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseMarketRepository, NodeSupabaseStoreSnapshotRepository, NodeSupabaseWalletEntryRepository } from "../src/economy/node-supabase-commerce.js";

function mock(payload:unknown,status=200){
 const original=globalThis.fetch;const calls:Array<{url:string;headers:Headers;body:Record<string,unknown>}>= [];
 globalThis.fetch=(async(input,init)=>{calls.push({url:String(input),headers:new Headers(init?.headers),body:JSON.parse(String(init?.body)) as Record<string,unknown>});return new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});}) as typeof fetch;
 return {calls,restore:()=>{globalThis.fetch=original;}};
}
const url="https://example.supabase.co";const key="commerce-node-service-role-test-key";

test("wallet entry uses atomic authenticated RPC and preserves bigint values",async()=>{
 const m=mock([{ledger_id:"ledger-1",balance:"9007199254740993123",version:8,replayed:false}]);
 try{const repo=new NodeSupabaseWalletEntryRepository(url,key);const result=await repo.applyWalletEntry({userId:"user-1",asset:"CASH",direction:"CREDIT",amount:12n,idempotencyKey:"wallet-entry-test-001",reason:"TEST_CREDIT",referenceType:"TEST",referenceId:"ref-1"});
 assert.equal(m.calls[0]!.url,url+"/rest/v1/rpc/apply_wallet_entry");assert.equal(m.calls[0]!.headers.get("authorization"),"Bearer "+key);assert.equal(m.calls[0]!.body.p_amount,"12");assert.equal(result.balance,"9007199254740993123");assert.equal(result.replayed,false);
 }finally{m.restore();}
});
test("wallet entry maps business errors and rejects malformed RPC rows",async()=>{
 const m=mock({message:"INSUFFICIENT_FUNDS"},400);try{const repo=new NodeSupabaseWalletEntryRepository(url,key);await assert.rejects(repo.applyWalletEntry({userId:"u",asset:"CASH",direction:"DEBIT",amount:3n,idempotencyKey:"wallet-entry-test-002",reason:"TEST"}),(e:unknown)=>e instanceof Error&&"code"in e&&e.code==="INSUFFICIENT_FUNDS");}finally{m.restore();}
 const bad=mock([{ledger_id:"x",balance:99,version:1,replayed:false}]);try{const repo=new NodeSupabaseWalletEntryRepository(url,key);await assert.rejects(repo.applyWalletEntry({userId:"u",asset:"CASH",direction:"DEBIT",amount:3n,idempotencyKey:"wallet-entry-test-003",reason:"TEST"}),/SUPABASE_WALLET_RPC_INVALID_RESPONSE/);}finally{bad.restore();}
});
test("market listing create cancel and read methods use the expected RPC contracts",async()=>{
 const m=mock([{listing_id:"listing-1",player_id:"player-1",asking_price:"500",status:"OPEN",expires_at:"2026-11-20T12:00:00Z",created_at:"2026-11-19T12:00:00Z"}]);
 try{const repo=new NodeSupabaseMarketRepository(url,key);const created=await repo.create({userId:"user-1",playerId:"player-1",askingPrice:"500",expiresInHours:24});assert.equal(created.id,"listing-1");assert.equal(m.calls[0]!.url,url+"/rest/v1/rpc/create_market_listing");assert.equal(m.calls[0]!.body.p_asking_price,"500");}finally{m.restore();}
 const c=mock([{listing_id:"listing-1",status:"CANCELLED"}]);try{const repo=new NodeSupabaseMarketRepository(url,key);assert.deepEqual(await repo.cancel({userId:"user-1",listingId:"listing-1"}),{listingId:"listing-1",status:"CANCELLED"});}finally{c.restore();}
 const reads=mock([{id:"listing-1"}]);try{const repo=new NodeSupabaseMarketRepository(url,key);assert.equal((await repo.listOpen()).length,1);assert.equal((await repo.listMine("user-1")).length,1);assert.equal(reads.calls[0]!.url,url+"/rest/v1/rpc/get_open_market_listings");assert.equal(reads.calls[1]!.body.p_user_id,"user-1");}finally{reads.restore();}
});
test("market purchase resolves seller and preserves expiration outcomes",async()=>{
 const seller=mock([{seller_user_id:"seller-1"}]);try{const repo=new NodeSupabaseMarketRepository(url,key);assert.equal(await repo.getSellerUserId("listing-1"),"seller-1");}finally{seller.restore();}
 const purchase=mock([{listing_id:"listing-1",player_id:null,price:null,replayed:false,error_code:"LISTING_EXPIRED"}]);try{const repo=new NodeSupabaseMarketRepository(url,key);assert.deepEqual(await repo.purchase({userId:"buyer-1",listingId:"listing-1"}),{error:"LISTING_EXPIRED"});assert.equal(purchase.calls[0]!.url,url+"/rest/v1/rpc/buy_market_listing");}finally{purchase.restore();}
});
test("store snapshot validates and returns typed wallet inventory and catalog rows",async()=>{
 const m=mock({wallets:[{asset:"CASH",balance:"1000"}],inventory:[{itemKey:"recovery_kit",quantity:2,updatedAt:"2026-11-19T12:00:00Z"}],specialPlayers:[{id:"sp-1",fullName:"Player One",nationality:"IR",positions:["ST"],rarity:"LEGENDARY",overall:90,potential:95}]});
 try{const repo=new NodeSupabaseStoreSnapshotRepository(url,key);const result=await repo.get("user-1");assert.equal(result.wallets[0]!.balance,"1000");assert.equal(result.inventory[0]!.quantity,2);assert.equal(m.calls[0]!.url,url+"/rest/v1/rpc/get_store_snapshot");}finally{m.restore();}
 const bad=mock({wallets:[{asset:"CASH",balance:10}],inventory:[],specialPlayers:[]});try{const repo=new NodeSupabaseStoreSnapshotRepository(url,key);await assert.rejects(repo.get("user-1"),/SUPABASE_STORE_SNAPSHOT_INVALID_RESPONSE/);}finally{bad.restore();}
});
test("commerce adapters reject unsafe Supabase origins",()=>{
 assert.throws(()=>new NodeSupabaseWalletEntryRepository("http://example.supabase.co",key));
 assert.throws(()=>new NodeSupabaseMarketRepository("https://attacker.example",key));
 assert.throws(()=>new NodeSupabaseStoreSnapshotRepository(url,"short"));
});
