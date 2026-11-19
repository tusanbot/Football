import type { WalletEntryCommand, WalletEntryPort, WalletEntryResult } from "./wallet-entry-context.js";
import type { MarketListingCreateCommand, MarketListingCreated, MarketListingPort } from "../players/market-listing-context.js";
import type { MarketPurchaseCommand, MarketPurchasePort, MarketPurchaseResult } from "../players/market-purchase-context.js";
import type { StoreSnapshot, StoreSnapshotPort } from "../store/store-snapshot-context.js";

type Row = Record<string, unknown>;
const WALLET_ERRORS = ["INVALID_AMOUNT","INSUFFICIENT_FUNDS","IDEMPOTENCY_CONFLICT","WALLET_NOT_FOUND","CONCURRENT_MODIFICATION"];
const MARKET_ERRORS = ["INVALID_LISTING","INVALID_USER","CLUB_NOT_FOUND","PLAYER_NOT_FOUND","SPECIAL_PLAYERS_NOT_TRADEABLE","PLAYER_NOT_AVAILABLE","MARKET_LOCKED_DURING_MATCH","MINIMUM_ACTIVE_SQUAD_REQUIRED","LISTING_NOT_FOUND","LISTING_NOT_OPEN","PLAYER_OWNERSHIP_CHANGED","CANNOT_BUY_OWN_PLAYER","WALLET_NOT_FOUND","INSUFFICIENT_FUNDS","CONCURRENT_MODIFICATION","IDEMPOTENCY_CONFLICT"];
class NodeSupabaseRpc {
  private readonly origin: string;
  constructor(url: string, private readonly key: string, private readonly timeoutMs=10_000) {
    const u=new URL(url);
    if(u.protocol!=="https:"||! /^[a-z0-9-]+\\.supabase\\.co$/i.test(u.hostname)||u.username||u.password||u.port||u.pathname!=="/"||u.search||u.hash) throw new TypeError("SUPABASE_URL must be a direct HTTPS Supabase project origin");
    if(key.trim().length<20) throw new TypeError("SUPABASE_SERVICE_ROLE_KEY is required");
    if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30_000) throw new RangeError("Invalid Supabase HTTP timeout");
    this.origin=u.origin;
  }
  async call(name:string,args:Record<string,unknown>,knownErrors:string[]=[]):Promise<unknown>{
    let response:Response;
    try{response=await fetch(this.origin+"/rest/v1/rpc/"+name,{method:"POST",redirect:"error",headers:{apikey:this.key,authorization:"Bearer "+this.key,accept:"application/json","content-type":"application/json"},body:JSON.stringify(args),signal:AbortSignal.timeout(this.timeoutMs)});}
    catch(error){throw new Error("Supabase RPC request failed",{cause:error});}
    const raw=await response.text(); let payload:unknown;
    try{payload=raw?JSON.parse(raw):null;}catch{throw new Error("Supabase RPC returned invalid JSON");}
    const row=payload&&typeof payload==="object"&&!Array.isArray(payload)?payload as Row:{};
    if(!response.ok||(typeof row.message==="string"||typeof row.error==="string")){
      const message=[row.message,row.error,row.details].find(x=>typeof x==="string") as string|undefined;
      const code=knownErrors.find(x=>message?.includes(x));
      if(code)throw Object.assign(new Error(code),{code});
      throw new Error("Supabase RPC rejected ("+response.status+")");
    }
    return payload;
  }
}
function rows(value:unknown,label:string):Row[]{const v=Array.isArray(value)?value:value&&typeof value==="object"?[value]:null;if(!v||v.some(x=>!x||typeof x!=="object"||Array.isArray(x)))throw new Error(label);return v as Row[];}
function mapRowsError(error:unknown,codes:string[]):never{const m=error instanceof Error?error.message:"";const code=codes.find(x=>m.includes(x));if(code)throw Object.assign(new Error(code),{code});throw error;}

export class NodeSupabaseWalletEntryRepository implements WalletEntryPort{
 private readonly rpc:NodeSupabaseRpc;constructor(url:string,key:string){this.rpc=new NodeSupabaseRpc(url,key);}
 async applyWalletEntry(input:WalletEntryCommand):Promise<WalletEntryResult>{
  let data:unknown;try{data=await this.rpc.call("apply_wallet_entry",{p_user_id:input.userId,p_asset:input.asset,p_direction:input.direction,p_amount:input.amount.toString(),p_idempotency_key:input.idempotencyKey,p_reason:input.reason,p_reference_type:input.referenceType??null,p_reference_id:input.referenceId??null},WALLET_ERRORS);}catch(e){return mapRowsError(e,WALLET_ERRORS);}
  const r=rows(data,"SUPABASE_WALLET_RPC_INVALID_RESPONSE")[0];
  if(!r||typeof r.ledger_id!=="string"||typeof r.balance!=="string"||! /^-?\\d+$/.test(r.balance)||!Number.isInteger(r.version)||typeof r.replayed!=="boolean")throw new Error("SUPABASE_WALLET_RPC_INVALID_RESPONSE");
  return {ledgerId:r.ledger_id,balance:r.balance,version:r.version as number,replayed:r.replayed};
 }
}
export class NodeSupabaseMarketRepository implements MarketListingPort,MarketPurchasePort{
 private readonly rpc:NodeSupabaseRpc;constructor(url:string,key:string){this.rpc=new NodeSupabaseRpc(url,key);}
 async create(input:MarketListingCreateCommand):Promise<MarketListingCreated>{
  let data:unknown;try{data=await this.rpc.call("create_market_listing",{p_user_id:input.userId,p_player_id:input.playerId,p_asking_price:input.askingPrice,p_expires_in_hours:input.expiresInHours},MARKET_ERRORS);}catch(e){return mapRowsError(e,MARKET_ERRORS);}
  const r=rows(data,"SUPABASE_MARKET_LISTING_INVALID_RESPONSE")[0];
  if(!r||typeof r.listing_id!=="string"||r.player_id!==input.playerId||r.asking_price!==input.askingPrice||r.status!=="OPEN"||typeof r.expires_at!=="string"||typeof r.created_at!=="string"||!Number.isFinite(Date.parse(r.expires_at))||!Number.isFinite(Date.parse(r.created_at)))throw new Error("SUPABASE_MARKET_LISTING_INVALID_RESPONSE");
  return {id:r.listing_id,playerId:r.player_id as string,askingPrice:r.asking_price as string,status:"OPEN",expiresAt:r.expires_at,createdAt:r.created_at};
 }
 async cancel(input:{userId:string;listingId:string}){let data:unknown;try{data=await this.rpc.call("cancel_market_listing",{p_user_id:input.userId,p_listing_id:input.listingId},MARKET_ERRORS);}catch(e){return mapRowsError(e,MARKET_ERRORS);}
  const r=rows(data,"SUPABASE_MARKET_LISTING_CANCEL_INVALID_RESPONSE")[0];if(!r||r.listing_id!==input.listingId||r.status!=="CANCELLED")throw new Error("SUPABASE_MARKET_LISTING_CANCEL_INVALID_RESPONSE");return {listingId:input.listingId,status:"CANCELLED" as const};}
 async listOpen(){const d=await this.rpc.call("get_open_market_listings",{},MARKET_ERRORS);return rows(d,"SUPABASE_MARKET_LISTINGS_INVALID_RESPONSE");}
 async listMine(userId:string){const d=await this.rpc.call("get_my_market_listings",{p_user_id:userId},MARKET_ERRORS);return rows(d,"SUPABASE_MY_MARKET_LISTINGS_INVALID_RESPONSE");}
 async getSellerUserId(listingId:string){const d=await this.rpc.call("get_market_listing_seller",{p_listing_id:listingId},MARKET_ERRORS);const r=rows(d,"SUPABASE_MARKET_SELLER_INVALID_RESPONSE")[0];if(!r||!(r.seller_user_id===null||typeof r.seller_user_id==="string"))throw new Error("SUPABASE_MARKET_SELLER_INVALID_RESPONSE");return r.seller_user_id as string|null;}
 async purchase(input:MarketPurchaseCommand):Promise<MarketPurchaseResult>{let d:unknown;try{d=await this.rpc.call("buy_market_listing",{p_user_id:input.userId,p_listing_id:input.listingId},MARKET_ERRORS);}catch(e){return mapRowsError(e,MARKET_ERRORS);}
  const r=rows(d,"SUPABASE_MARKET_PURCHASE_INVALID_RESPONSE")[0];if(!r||r.listing_id!==input.listingId||typeof r.replayed!=="boolean")throw new Error("SUPABASE_MARKET_PURCHASE_INVALID_RESPONSE");
  if(r.error_code==="PLAYER_CONTRACT_EXPIRED"||r.error_code==="LISTING_EXPIRED")return {error:r.error_code};
  if(r.error_code!==null&&r.error_code!==undefined||typeof r.player_id!=="string"||typeof r.price!=="string"||! /^-?\\d+$/.test(r.price))throw new Error("SUPABASE_MARKET_PURCHASE_INVALID_RESPONSE");
  return {listingId:r.listing_id,playerId:r.player_id,price:r.price,replayed:r.replayed};
 }
}
export class NodeSupabaseStoreSnapshotRepository implements StoreSnapshotPort{
 private readonly rpc:NodeSupabaseRpc;constructor(url:string,key:string){this.rpc=new NodeSupabaseRpc(url,key);}
 async get(userId:string):Promise<StoreSnapshot>{const d=await this.rpc.call("get_store_snapshot",{p_user_id:userId});const r=rows(d,"SUPABASE_STORE_SNAPSHOT_INVALID_RESPONSE")[0];if(!r||!Array.isArray(r.wallets)||!Array.isArray(r.inventory)||!Array.isArray(r.specialPlayers))throw new Error("SUPABASE_STORE_SNAPSHOT_INVALID_RESPONSE");
  const validWallets=r.wallets.every((x:any)=>x&&typeof x.asset==="string"&&typeof x.balance==="string"&& /^-?\\d+$/.test(x.balance));
  const validInventory=r.inventory.every((x:any)=>x&&typeof x.itemKey==="string"&&Number.isInteger(x.quantity)&&typeof x.updatedAt==="string");
  const validPlayers=r.specialPlayers.every((x:any)=>x&&typeof x.id==="string"&&typeof x.fullName==="string"&&typeof x.nationality==="string"&&Array.isArray(x.positions)&&typeof x.rarity==="string"&&Number.isInteger(x.overall)&&Number.isInteger(x.potential));
  if(!validWallets||!validInventory||!validPlayers)throw new Error("SUPABASE_STORE_SNAPSHOT_INVALID_RESPONSE");
  return r as unknown as StoreSnapshot;
 }
}
