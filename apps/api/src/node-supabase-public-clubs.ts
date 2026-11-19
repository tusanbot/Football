import type { PublicClubReadRepository, PublicClubRecord, PublicClubProfile, PublicClubComparison } from "./public-club-routes.js";
import { SupabaseHttpClient } from "./node-supabase-http.js";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(label);
  return value;
}
function clubRecord(value: unknown): PublicClubRecord {
  const row=object(value,"INVALID_PUBLIC_CLUB_RECORD");
  if(typeof row.id!=="string"||typeof row.name!=="string"||!Number.isInteger(row.level)
    ||!Number.isInteger(row.reputation)||!(row.logoMime===null||typeof row.logoMime==="string")) throw new Error("INVALID_PUBLIC_CLUB_RECORD");
  return {id:row.id,name:row.name,level:row.level as number,reputation:row.reputation as number,logoMime:row.logoMime as string|null,
    pyramidLeagueEntries:array(row.pyramidLeagueEntries,"INVALID_PUBLIC_CLUB_HISTORY") as PublicClubRecord["pyramidLeagueEntries"]};
}
export class NodeSupabasePublicClubRepository implements PublicClubReadRepository {
  constructor(private readonly client:SupabaseHttpClient){}
  async list(query:string|null):Promise<PublicClubRecord[]>{
    const result=object(await this.client.rpc("get_public_clubs_http",{p_query:query,p_limit:100}),"INVALID_PUBLIC_CLUB_LIST_RESPONSE");
    return array(result.clubs,"INVALID_PUBLIC_CLUB_LIST_RESPONSE").map(clubRecord);
  }
  async profile(clubId:string):Promise<PublicClubProfile|null>{
    const result=await this.client.rpc("get_public_club_profile_http",{p_club_id:clubId});
    if(result===null)return null;
    const row=object(result,"INVALID_PUBLIC_CLUB_PROFILE_RESPONSE");
    const base=clubRecord(row);
    if(typeof row.slug!=="string"||typeof row.createdAt!=="string"||!Number.isFinite(Date.parse(row.createdAt)))throw new Error("INVALID_PUBLIC_CLUB_PROFILE_RESPONSE");
    return {...base,slug:row.slug,createdAt:row.createdAt};
  }
  async compare(first:string,second:string):Promise<PublicClubComparison|null>{
    const result=object(await this.client.rpc("compare_public_clubs_http",{p_first:first,p_second:second}),"INVALID_PUBLIC_CLUB_COMPARISON_RESPONSE");
    if(result.clubs===null)return null;
    const clubs=array(result.clubs,"INVALID_PUBLIC_CLUB_COMPARISON_RESPONSE").map((value)=>{
      const row=object(value,"INVALID_PUBLIC_CLUB_COMPARISON_RESPONSE");
      if(typeof row.id!=="string"||typeof row.name!=="string"||!Number.isInteger(row.level)||!Number.isInteger(row.reputation)
        ||!(row.logoMime===null||typeof row.logoMime==="string"))throw new Error("INVALID_PUBLIC_CLUB_COMPARISON_RESPONSE");
      return {id:row.id,name:row.name,level:row.level as number,reputation:row.reputation as number,logoMime:row.logoMime as string|null};
    });
    if(clubs.length!==2)throw new Error("INVALID_PUBLIC_CLUB_COMPARISON_RESPONSE");
    return {clubs,matches:array(result.matches,"INVALID_PUBLIC_CLUB_COMPARISON_RESPONSE") as PublicClubComparison["matches"]};
  }
}
