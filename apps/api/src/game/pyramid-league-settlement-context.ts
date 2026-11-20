import { AsyncLocalStorage } from "node:async_hooks";
export interface PyramidLeagueSettlementPort {
 apply(userId:string,tier:number,now:string):Promise<Record<string,unknown>>;
 finalize(competitionId:string,now:string):Promise<{processed:boolean;replayed?:boolean;leagueId?:string;champion?:string;runnerUp?:string;thirdPlace?:string}>;
 respond(userId:string,offerId:string,accept:boolean,now:string):Promise<Record<string,unknown>>;
 processDue(now:string,limit:number):Promise<{completedLeagues:number;processed:number;accepted:number}>;
 listLeagues(userId:string):Promise<Record<string,unknown>>;
 getClubHistory(userId:string):Promise<Record<string,unknown>>;
 getLeagueDetails(userId:string,leagueId:string):Promise<Record<string,unknown>>;
 listNotices(userId:string):Promise<{notices:unknown[]}>;
 markNoticesRead(userId:string,now:string):Promise<{markedRead:number}>;
 claimNotices(limit:number,now:string):Promise<{notices:unknown[]}>;
 completeNotice(id:string,claimToken:string,now:string):Promise<{completed:boolean}>;
 failNotice(id:string,claimToken:string,error:string,now:string):Promise<{owned:boolean;rescheduled?:boolean;attempts?:number}>;
}
const scope=new AsyncLocalStorage<PyramidLeagueSettlementPort>();
export function withPyramidLeagueSettlementPort<T>(port:PyramidLeagueSettlementPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
export function getPyramidLeagueSettlementPort():PyramidLeagueSettlementPort|undefined{return scope.getStore();}
