import { getActionRateLimitPort } from "./action-rate-limit-context.js";

export async function consumeAllianceActionRateLimit(input: {
  telegramUserId: string;
  telegramGroupId: string;
  action: string;
  limit: number;
  now?: Date;
}): Promise<boolean> {
  const port = getActionRateLimitPort();
  if (!port) throw new Error("SUPABASE_ACTION_RATE_LIMIT_UNAVAILABLE");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000) {
    throw new RangeError("Invalid action rate limit");
  }
  const now = input.now ?? new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const key = [input.telegramUserId, input.telegramGroupId, input.action].join(":").slice(0, 240);
  return port.consume({ key, windowStart: windowStart.toISOString(), now: now.toISOString(), limit: input.limit });
}
