export type BotRuntimeLeaseAction = "acquire" | "heartbeat" | "release";
export interface BotRuntimeLeaseResult {
  acquired: boolean;
  released: boolean;
  leaseExpiresAt: string | null;
}
export interface BotRuntimeLeasePort {
  execute(instanceId: string, action: BotRuntimeLeaseAction, now: string): Promise<BotRuntimeLeaseResult>;
}
