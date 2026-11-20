import { AsyncLocalStorage } from "node:async_hooks";

export interface ActionRateLimitCommand {
  key: string;
  windowStart: string;
  now: string;
  limit: number;
}
export interface ActionRateLimitPort {
  consume(input: ActionRateLimitCommand): Promise<boolean>;
}
const scope = new AsyncLocalStorage<ActionRateLimitPort>();
export function withActionRateLimitPort<T>(port: ActionRateLimitPort, operation: () => T): T {
  return scope.run(port, operation);
}
export function getActionRateLimitPort(): ActionRateLimitPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("ACTION_RATE_LIMIT_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
