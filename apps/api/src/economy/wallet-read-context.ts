import { AsyncLocalStorage } from "node:async_hooks";
export interface WalletReadPort {
 list(userId:string):Promise<Array<{asset:string;balance:string;version:number;updatedAt:string}>>;
}
const scope=new AsyncLocalStorage<WalletReadPort>();
export function withWalletReadPort<T>(port:WalletReadPort,operation:()=>Promise<T>):Promise<T>{return scope.run(port,operation);}
export function getWalletReadPort(): WalletReadPort|undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("WALLET_READ_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
