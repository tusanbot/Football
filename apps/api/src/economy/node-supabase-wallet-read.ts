import type { WalletReadPort } from "./wallet-read-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";
interface WalletRow { asset:string; balance:string|number; version:number; updatedAt:string; }
export class NodeSupabaseWalletReadRepository implements WalletReadPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async list(userId:string){
  const rows=await this.client.select<WalletRow[]>("Wallet",{
   select:"asset,balance,version,updatedAt",userId:"eq."+userId,order:"asset.asc",
  });
  if(!Array.isArray(rows)||rows.some(row=>!row||typeof row.asset!=="string"||!/^\d+$/.test(String(row.balance))||!Number.isInteger(row.version)||typeof row.updatedAt!=="string"||!Number.isFinite(Date.parse(row.updatedAt))))throw new Error("SUPABASE_WALLET_READ_INVALID_RESPONSE");
  return rows.map(row=>({asset:row.asset,balance:String(row.balance),version:row.version,updatedAt:new Date(row.updatedAt).toISOString()}));
 }
}
