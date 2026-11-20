import { AsyncLocalStorage } from "node:async_hooks";

export interface MatchRuntimeLeaseClaimCommand {
  workerId: string;
  now: string;
  leaseMs: number;
  limit: number;
}
export interface MatchRuntimeLease {
  runtime: { id: string };
  lease: { owner: string; token: string; expiresAt: Date };
}
export interface MatchRuntimeLeaseReleaseCommand {
  runtimeId: string;
  leaseToken: string;
  nextActionAt: string | null;
  lastError: string | null;
}
export interface MatchRuntimeLeasePort {
  claim(input: MatchRuntimeLeaseClaimCommand): Promise<MatchRuntimeLease[]>;
  release(input: MatchRuntimeLeaseReleaseCommand): Promise<boolean>;
}

const scope = new AsyncLocalStorage<MatchRuntimeLeasePort>();
export function withMatchRuntimeLeasePort<T>(port: MatchRuntimeLeasePort, operation: () => T): T {
  return scope.run(port, operation);
}
export function getMatchRuntimeLeasePort(): MatchRuntimeLeasePort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("MATCH_RUNTIME_LEASE_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
