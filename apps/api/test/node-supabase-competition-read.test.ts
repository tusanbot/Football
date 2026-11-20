import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { SupabaseCompetitionReadRepository } from "../src/game/node-supabase-competition-read.js";
import { withCompetitionReadPort } from "../src/game/competition-read-context.js";
import { listOpenLeagues, getLeague, MatchServiceError } from "../src/game/match-service.js";

const openCompetition={id:"comp-1",name:"Autumn League",season:2026,format:"LEAGUE",cupLegs:1,rules:{penaltiesOnDraw:false},status:"REGISTRATION",maxTeams:8,teams:3,joined:true,isCreator:false,creator:"North FC"};
const detail={competition:{id:"comp-1",name:"Autumn League",season:2026,format:"LEAGUE",cupLegs:1,rules:{penaltiesOnDraw:false},status:"ACTIVE",startsAt:"2026-11-20T00:00:00Z"},standings:[],matches:[],nextRound:null,nextRoundMatches:[],topScorers:[]};
function makeRepository(response:unknown,seen:{path:string;body:Record<string,unknown>}[]=[]){
 const client=new SupabaseHttpClient({url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",fetchImpl:async(input,init)=>{
  seen.push({path:new URL(String(input)).pathname,body:JSON.parse(String(init?.body)) as Record<string,unknown>});
  return new Response(JSON.stringify(response),{status:200,headers:{"content-type":"application/json"}});
 }});
 return {repo:new SupabaseCompetitionReadRepository(client),seen};
}
test("competition read repository uses the dedicated Supabase RPCs",async()=>{
 const seen:{path:string;body:Record<string,unknown>}[]=[];
 const {repo}=makeRepository([openCompetition],seen);
 const listed=await repo.listOpen("user-1");
 assert.equal(listed[0]?.id,"comp-1");
 assert.deepEqual(seen[0],{path:"/rest/v1/rpc/list_open_competitions_http",body:{p_user_id:"user-1"}});
 const detailRepo=makeRepository(detail,seen).repo;
 const result=await detailRepo.get("user-1","comp-1");
 assert.equal((result.competition as Record<string,unknown>).id,"comp-1");
 assert.deepEqual(seen[1],{path:"/rest/v1/rpc/get_competition_http",body:{p_user_id:"user-1",p_competition_id:"comp-1"}});
});
test("competition read repository rejects malformed RPC payloads",async()=>{
 const {repo}=makeRepository([{id:"comp-1"}]);
 await assert.rejects(()=>repo.listOpen("user-1"),/SUPABASE_COMPETITION_LIST_INVALID_RESPONSE/);
});
test("match service routes league reads through the scoped Supabase port",async()=>{
 const calls:string[]=[];
 const port={
  async listOpen(userId:string){calls.push("list:"+userId);return [openCompetition];},
  async get(userId:string,id:string){calls.push("get:"+userId+":"+id);return detail;},
 };
 await withCompetitionReadPort(port,async()=>{
  const listed=await listOpenLeagues("user-1");
  assert.equal(listed[0]?.id,"comp-1");
  const read=await getLeague("user-1","comp-1");
  assert.equal((read.competition as Record<string,unknown>).id,"comp-1");
 });
 assert.deepEqual(calls,["list:user-1","get:user-1:comp-1"]);
});
test("Supabase competition read errors retain domain error codes",async()=>{
 const client=new SupabaseHttpClient({url:"https://example.supabase.co",serviceRoleKey:"service-role-key-that-is-long-enough",fetchImpl:async()=>new Response(JSON.stringify({message:"NOT_COMPETITION_MEMBER",code:"P0001"}),{status:400,headers:{"content-type":"application/json"}})});
 const repo=new SupabaseCompetitionReadRepository(client);
 await assert.rejects(()=>repo.get("user-1","comp-1"),/NOT_COMPETITION_MEMBER/);
 await assert.rejects(()=>withCompetitionReadPort(repo,()=>getLeague("user-1","comp-1")), (error:unknown)=>error instanceof MatchServiceError && error.code==="NOT_COMPETITION_MEMBER");
});
