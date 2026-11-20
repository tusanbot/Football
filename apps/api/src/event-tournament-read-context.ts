import { AsyncLocalStorage } from "node:async_hooks";
export interface EventTournamentReadPort {
 listForUser(userId:string):Promise<Record<string, unknown>[]>;
 listForAdmin():Promise<Record<string, unknown>[]>;
 listParticipants(tournamentId:string):Promise<Record<string, unknown>[]>;
}
const scope=new AsyncLocalStorage<EventTournamentReadPort>();
export function withEventTournamentReadPort<T>(port:EventTournamentReadPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
export function getEventTournamentReadPort():EventTournamentReadPort|undefined{return scope.getStore();}
