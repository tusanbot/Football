import { AsyncLocalStorage } from "node:async_hooks";
import type { CompetitionAdvancementResult } from "./competition-advancement-context.js";
export interface MatchRuntimeForfeitResult { settled:boolean; replayed:boolean; matchId:string; competitionId:string|null; round:number|null; competitionFormat:string|null; advancement:CompetitionAdvancementResult|null; pyramidFinalization:Record<string,unknown>|null; eventTournamentFinalization:Record<string,unknown>|null; }
export interface MatchRuntimeForfeitPort { forfeit(matchId:string,now:string):Promise<MatchRuntimeForfeitResult>; }
const scope=new AsyncLocalStorage<MatchRuntimeForfeitPort>();
export function getMatchRuntimeForfeitPort(){return scope.getStore();}
export function withMatchRuntimeForfeitPort<T>(port:MatchRuntimeForfeitPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
