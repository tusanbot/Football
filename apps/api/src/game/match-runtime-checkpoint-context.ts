import { AsyncLocalStorage } from "node:async_hooks";

export interface MatchRuntimeCheckpointEvent {
  eventKey: string;
  kind: string;
  minute: number;
  homeScore: number;
  awayScore: number;
  payload: Record<string, unknown> | null;
  availableAt: string;
}
export interface MatchRuntimeCheckpointCommand {
  runtimeId: string;
  checkpointId: string;
  expectedStateVersion: number;
  leaseToken: string;
  resolution: unknown;
  nextMinute: 60 | 75 | 90;
  simulationState: unknown;
  nextActionAt: string;
  events: MatchRuntimeCheckpointEvent[];
  nextCheckpoint: null | {
    checkpointKey: string;
    kind: "MINUTE_60" | "MINUTE_75";
    minute: 60 | 75;
    openedAt: string;
    decisionDeadlineAt: string;
    nextSegmentAt: string;
  };
}
export interface MatchRuntimeCheckpointPort {
  resolveCheckpoint(input: MatchRuntimeCheckpointCommand): Promise<boolean>;
}
const scope = new AsyncLocalStorage<MatchRuntimeCheckpointPort>();
export function withMatchRuntimeCheckpointPort<T>(port: MatchRuntimeCheckpointPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getMatchRuntimeCheckpointPort(): MatchRuntimeCheckpointPort | undefined {
  return scope.getStore();
}
