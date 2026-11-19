import { AsyncLocalStorage } from "node:async_hooks";
export interface WalletReadPort {
 list(userId:string):Promise<Array<{asset:string;balance:string;version:number;updatedAt:string}>>;
}
const scope=new AsyncLocalStorage<WalletReadPort>();
export function withWalletReadPort<T>(port:WalletReadPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
export function getWalletReadPort():WalletReadPort|undefined{return scope.getStore();}
