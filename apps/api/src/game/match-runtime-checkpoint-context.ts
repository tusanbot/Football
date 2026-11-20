import { AsyncLocalStorage } from "node:async_hooks";

export interface MatchRuntimeCheckpointEvent {
  eventKey: string;
  kind: string;
  minute: number;
  homeScore: number;
  awayScore: number;
  payload: unknown;
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
export interface MatchRuntimeCheckpointSnapshot {
  checkpoint: {
    id: string; checkpointKey: string; kind: "HALF_TIME" | "MINUTE_60" | "MINUTE_75";
    minute: number; status: "OPEN" | "RESOLVED" | "EXPIRED";
    openedAt: string; decisionDeadlineAt: string; nextSegmentAt: string;
  };
  decisions: Array<{ id: string; clubId: string; submittedAt: string; instruction: unknown }>;
}
export interface MatchRuntimeCheckpointDecisionCommand {
  userId: string; matchId: string; checkpointKey: string; idempotencyKey: string;
  instruction: unknown; submittedAt: string;
}
export interface MatchRuntimeCheckpointDecisionResult {
  decision: { id: string; checkpointId: string; clubId: string; submittedByUserId: string;
    idempotencyKey: string; instruction: unknown; submittedAt: string };
  replayed: boolean;
}
export interface MatchRuntimeCheckpointPort {
  resolveCheckpoint(input: MatchRuntimeCheckpointCommand): Promise<boolean>;
  getOpenCheckpoint(matchId: string): Promise<MatchRuntimeCheckpointSnapshot | null>;
  submitDecision(input: MatchRuntimeCheckpointDecisionCommand): Promise<MatchRuntimeCheckpointDecisionResult>;
  enqueueLifecycleEvents(matchId: string, events: MatchRuntimeCheckpointEvent[]): Promise<number>;
}
const scope = new AsyncLocalStorage<MatchRuntimeCheckpointPort>();
export function withMatchRuntimeCheckpointPort<T>(port: MatchRuntimeCheckpointPort, operation: () => Promise<T>): Promise<T> {
  return scope.run(port, operation);
}
export function getMatchRuntimeCheckpointPort(): MatchRuntimeCheckpointPort | undefined {
  const port = scope.getStore();
  if (!port && (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")) {
    throw new Error("MATCH_CHECKPOINT_SUPABASE_REPOSITORY_REQUIRED");
  }
  return port;
}
