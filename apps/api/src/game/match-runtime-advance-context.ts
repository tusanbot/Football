import { AsyncLocalStorage } from "node:async_hooks";

export interface MatchRuntimeFirstHalfCommand {
  runtimeId: string;
  expectedStateVersion: number;
  leaseToken: string;
  simulationState: unknown;
  startedAt: string;
  checkpointAt: string;
  decisionDeadlineAt: string;
  events: Array<{
    eventKey: string; kind: string; minute: number; homeScore: number; awayScore: number;
    payload: Record<string, unknown> | null; availableAt: string;
  }>;
}
export interface MatchRuntimeAdvancePort {
  advanceFirstHalf(input: MatchRuntimeFirstHalfCommand): Promise<boolean>;
}
const scope = new AsyncLocalStorage<MatchRuntimeAdvancePort>();
export function withMatchRuntimeAdvancePort<T>(port: MatchRuntimeAdvancePort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getMatchRuntimeAdvancePort(): MatchRuntimeAdvancePort | undefined {
  return scope.getStore();
}
