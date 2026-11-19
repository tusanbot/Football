import { AsyncLocalStorage } from "node:async_hooks";
export interface EventTournamentSettlementPort {
 finalize(competitionId:string,now:string):Promise<{finalized:boolean;replayed:boolean;participants:number;awards:number}>;
 processDue(now:string,limit:number):Promise<{candidates:number;finalized:number;failed:number}>;
}
const scope=new AsyncLocalStorage<EventTournamentSettlementPort>();
export function withEventTournamentSettlementPort<T>(port:EventTournamentSettlementPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
export function getEventTournamentSettlementPort():EventTournamentSettlementPort|undefined{return scope.getStore();}
