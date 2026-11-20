import { AsyncLocalStorage } from "node:async_hooks";
export interface EventTournamentCreateInput {\n telegramUserId:string; idempotencyKey:string; title:string; description:string;\n entryFeeAsset:string|null; entryFeeAmount:string; maxParticipants:number;\n registrationEndsAt:string; startsAt:string; endsAt:string|null;\n prizes:Array<{placement:number;type:string;amount:string;itemKey:string|null;specialPlayerId:string|null}>;\n}\nexport interface EventTournamentReadPort {\n create(input:EventTournamentCreateInput):Promise<{tournament:Record<string,unknown>;replayed:boolean}>;
 listForUser(userId:string):Promise<Record<string, unknown>[]>;
 listForAdmin():Promise<Record<string, unknown>[]>;
 listParticipants(tournamentId:string):Promise<Record<string, unknown>[]>;
}
const scope=new AsyncLocalStorage<EventTournamentReadPort>();
export function withEventTournamentReadPort<T>(port:EventTournamentReadPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
export function getEventTournamentReadPort():EventTournamentReadPort|undefined{return scope.getStore();}
