import { AsyncLocalStorage } from "node:async_hooks";
export interface CompetitionAdvancementCommand { competitionId: string; round: number; now: string; }
export interface CompetitionAdvancementResult {
 competitionId: string; format: "LEAGUE"|"CUP"; completed: boolean; roundComplete: boolean;
 nextRound: number|null; fixturesCreated: number; noticesCreated: number; replayed: boolean;
}
export interface CompetitionAdvancementPort { advance(input: CompetitionAdvancementCommand): Promise<CompetitionAdvancementResult>; }
const scope=new AsyncLocalStorage<CompetitionAdvancementPort>();
export function withCompetitionAdvancementPort<T>(port:CompetitionAdvancementPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
export function getCompetitionAdvancementPort():CompetitionAdvancementPort|undefined{return scope.getStore();}
