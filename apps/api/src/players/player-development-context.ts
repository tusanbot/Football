import { AsyncLocalStorage } from "node:async_hooks";
import type { TrainingFocus, TrainingIntensity } from "@football/domain";
export interface PlayerDevelopmentPort {
 settle(userId:string,now:Date):Promise<unknown>;
 get(userId:string,now:Date):Promise<unknown>;
 train(userId:string,playerId:string,focus:TrainingFocus,intensity:TrainingIntensity,key:string,now:Date):Promise<unknown>;
 renew(userId:string,playerId:string,days:number,wage:bigint,key:string,now:Date):Promise<unknown>;
}
const scope=new AsyncLocalStorage<PlayerDevelopmentPort>();
export const withPlayerDevelopmentPort=<T>(port:PlayerDevelopmentPort,fn:()=>Promise<T>)=>scope.run(port,fn);
export const getPlayerDevelopmentPort=()=>scope.getStore();
