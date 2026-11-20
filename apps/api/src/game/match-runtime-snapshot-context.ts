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
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("MATCH_RUNTIME_SNAPSHOT_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
