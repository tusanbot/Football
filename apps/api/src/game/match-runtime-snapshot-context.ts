import { AsyncLocalStorage } from "node:async_hooks";

export interface MatchRuntimeSnapshotPort {
  get(runtimeId: string): Promise<unknown | null>;
}

const scope = new AsyncLocalStorage<MatchRuntimeSnapshotPort>();

export function withMatchRuntimeSnapshotPort<T>(
  port: MatchRuntimeSnapshotPort,
  operation: () => Promise<T>,
): Promise<T> {
  return scope.run(port, operation);
}

export function getMatchRuntimeSnapshotPort(): MatchRuntimeSnapshotPort | undefined {
  return scope.getStore();
}
