export interface AllianceActorInput { telegramUserId: string; telegramGroupId: string; }
export interface AlliancePort {
 createAlliance(input: AllianceActorInput & {name:string;description?:string;idempotencyKey:string}):Promise<unknown>;
 inviteAllianceGroup(input: AllianceActorInput & {targetTelegramGroupId:string}):Promise<unknown>;
 respondAllianceInvitation(input: AllianceActorInput & {invitationId:string;accept:boolean}):Promise<unknown>;
 contributeAllianceTreasury(input: AllianceActorInput & {amount:string;idempotencyKey:string}):Promise<unknown>;
 getAllianceWorkspace(input:AllianceActorInput & {isReviewer:boolean}):Promise<unknown>;
 startAllianceSeason(input:AllianceActorInput & {durationDays?:number}):Promise<unknown>;
 closeAllianceSeason(input:AllianceActorInput):Promise<unknown>;
 reviewAllianceSeason(input:AllianceActorInput & {seasonId:string;decision:'APPROVE'|'REJECT';isReviewer:boolean}):Promise<unknown>;
 createAllianceChampionship(input:AllianceActorInput & {name:string;maxTeams:number;idempotencyKey:string}):Promise<unknown>;
 joinAllianceChampionship(input:AllianceActorInput & {competitionId:string}):Promise<unknown>;
 startAllianceChampionship(input:AllianceActorInput & {competitionId:string;now:string}):Promise<unknown>;
}
import { AsyncLocalStorage } from "node:async_hooks";
const scope = new AsyncLocalStorage<AlliancePort>();
export function withAlliancePort<T>(port:AlliancePort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
export function getAlliancePort():AlliancePort|undefined{return scope.getStore();}
