import { AsyncLocalStorage } from "node:async_hooks";
export interface MatchRuntimeForfeitResult { settled:boolean; replayed:boolean; matchId:string; competitionId:string|null; round:number|null; competitionFormat:string|null; }
export interface MatchRuntimeForfeitPort { forfeit(matchId:string,now:string):Promise<MatchRuntimeForfeitResult>; }
const scope=new AsyncLocalStorage<MatchRuntimeForfeitPort>();
export function getMatchRuntimeForfeitPort(){return scope.getStore();}
export function withMatchRuntimeForfeitPort<T>(port:MatchRuntimeForfeitPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
