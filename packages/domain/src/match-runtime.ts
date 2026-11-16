export type MatchTacticalInstruction = {
  formation?: string; mentality?: "DEFENSIVE" | "BALANCED" | "ATTACKING";
  pressing?: "LOW_BLOCK" | "MID_BLOCK" | "HIGH_PRESS"; tempo?: "SLOW" | "NORMAL" | "FAST";
  passingStyle?: "SHORT" | "MIXED" | "DIRECT";
  substitutions?: Array<{ outgoingPlayerId: string; incomingPlayerId: string }>;
};
export type MatchRuntimeLease = { owner: string; token: string; expiresAt: Date };
export type MatchRuntimeLeaseState = { leaseOwner: string | null; leaseToken: string | null; leaseExpiresAt: Date | null };
export function canAcquireMatchRuntimeLease(current: MatchRuntimeLeaseState, now: Date): boolean {
  return current.leaseExpiresAt === null || current.leaseExpiresAt.getTime() <= now.getTime();
}
export function isMatchRuntimeLeaseCurrent(current: MatchRuntimeLeaseState, lease: MatchRuntimeLease, now: Date): boolean {
  return current.leaseOwner === lease.owner && current.leaseToken === lease.token
    && current.leaseExpiresAt !== null && current.leaseExpiresAt.getTime() > now.getTime();
}
export function matchRuntimeNextCheckpoint(currentMinute: number): {
  minute: number; kind: "HALF_TIME" | "MINUTE_60" | "MINUTE_75" | "FULL_TIME";
} | null {
  if (!Number.isInteger(currentMinute) || currentMinute < 0 || currentMinute > 90) throw new Error("INVALID_MATCH_RUNTIME_MINUTE");
  if (currentMinute < 45) return { minute: 45, kind: "HALF_TIME" };
  if (currentMinute < 60) return { minute: 60, kind: "MINUTE_60" };
  if (currentMinute < 75) return { minute: 75, kind: "MINUTE_75" };
  if (currentMinute < 90) return { minute: 90, kind: "FULL_TIME" };
  return null;
}
