import { AsyncLocalStorage } from "node:async_hooks";
export interface MatchRuntimeEnqueueResult { enqueued: number; invalidFixtures: Array<{ id: string; ownerId: string }>; }
export interface MatchRuntimeEnqueuePort { enqueue(now: string, limit: number): Promise<MatchRuntimeEnqueueResult>; }
const scope = new AsyncLocalStorage<MatchRuntimeEnqueuePort>();
export function getMatchRuntimeEnqueuePort(): MatchRuntimeEnqueuePort | undefined {
 const port = scope.getStore();
 if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
  throw new Error("MATCH_RUNTIME_ENQUEUE_SUPABASE_REPOSITORY_REQUIRED");
 }
 return port;
}
export function withMatchRuntimeEnqueuePort<T>(port: MatchRuntimeEnqueuePort, operation: () => Promise<T>): Promise<T> {
 return scope.run(port, operation);
}
