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
  return scope.getStore();
}
