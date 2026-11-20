import assert from "node:assert/strict";
import test from "node:test";
import { consumeAllianceActionRateLimit } from "../src/groups/alliance-rate-limit.js";
import { withActionRateLimitPort } from "../src/groups/action-rate-limit-context.js";

test("alliance action limits are atomic per actor, group and minute", async () => {
  const counts = new Map<string, number>();
  const port = {
    async consume(input: { key: string; windowStart: string; limit: number }) {
      const storageKey = input.key + ":" + input.windowStart;
      const count = counts.get(storageKey) ?? 0;
      if (count >= input.limit) return false;
      counts.set(storageKey, count + 1);
      return true;
    },
  };
  await withActionRateLimitPort(port, async () => {
    const id = "rate-test-user";
    const now = new Date("2026-11-14T12:00:00.000Z");
    assert.equal(await consumeAllianceActionRateLimit({ telegramUserId: id, telegramGroupId: "-100123", action: "invite", limit: 2, now }), true);
    assert.equal(await consumeAllianceActionRateLimit({ telegramUserId: id, telegramGroupId: "-100123", action: "invite", limit: 2, now }), true);
    assert.equal(await consumeAllianceActionRateLimit({ telegramUserId: id, telegramGroupId: "-100123", action: "invite", limit: 2, now }), false);
    assert.equal(await consumeAllianceActionRateLimit({ telegramUserId: id, telegramGroupId: "-100123", action: "invite", limit: 2, now: new Date(now.getTime() + 60_000) }), true);
  });
});
