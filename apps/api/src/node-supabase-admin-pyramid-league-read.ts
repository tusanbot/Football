import { SupabaseHttpClient } from "./node-supabase-http.js";
export interface AdminPyramidLeagueFilters { season?:number; tier?:number; status?:string; q?:string; limit:number; }
export interface AdminPyramidLeagueReadPort { list(filters:AdminPyramidLeagueFilters):Promise<Record<string,unknown>>; }
export class NodeSupabaseAdminPyramidLeagueReadRepository implements AdminPyramidLeagueReadPort {
 constructor(private readonly client:SupabaseHttpClient){}
 async list(filters:AdminPyramidLeagueFilters){
  const result=await this.client.rpc<Record<string,unknown>>("get_admin_pyramid_leagues_http",{
   p_season:filters.season??null,p_tier:filters.tier??null,p_status:filters.status??null,
   p_query:filters.q??null,p_limit:filters.limit,
  });
  if(!result||!Array.isArray(result.leagues)||!Array.isArray(result.queues)||!Array.isArray(result.offers)
   ||!result.applicationCounts||typeof result.applicationCounts!=="object"){
   throw new Error("SUPABASE_ADMIN_PYRAMID_LEAGUES_INVALID_RESPONSE");
  }
  return result;
 }
}
