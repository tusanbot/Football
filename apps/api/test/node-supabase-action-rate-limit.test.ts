import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { NodeSupabaseActionRateLimitRepository } from "../src/groups/node-supabase-action-rate-limit.js";
import { consumeAllianceActionRateLimit } from "../src/groups/alliance-rate-limit.js";
import { withActionRateLimitPort } from "../src/groups/action-rate-limit-context.js";

test("action rate limiting fails closed without a Supabase port", async () => {
  await assert.rejects(
    consumeAllianceActionRateLimit({ telegramUserId: "123", telegramGroupId: "global", action: "test", limit: 2 }),
    /SUPABASE_ACTION_RATE_LIMIT_UNAVAILABLE/,
  );
});

test("action rate limit helper sends a minute-scoped key through its port", async () => {
  const received: unknown[] = [];
  await withActionRateLimitPort({
    async consume(input) { received.push(input); return true; },
  }, async () => {
    const allowed = await consumeAllianceActionRateLimit({
      telegramUserId: "123", telegramGroupId: "global", action: "gift", limit: 5,
      now: new Date("2026-11-20T09:48:27.000Z"),
    });
    assert.equal(allowed, true);
  });
  assert.deepEqual(received, [{
    key: "123:global:gift",
    windowStart: "2026-11-20T09:48:00.000Z",
    now: "2026-11-20T09:48:27.000Z",
    limit: 5,
  }]);
});

test("Node rate limit repository invokes the atomic Supabase RPC", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-test-key-with-enough-length",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response("true", { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const repository = new NodeSupabaseActionRateLimitRepository(client);
  const allowed = await repository.consume({
    key: "123:global:gift", windowStart: "2026-11-20T09:48:00.000Z",
    now: "2026-11-20T09:48:27.000Z", limit: 5,
  });
  assert.equal(allowed, true);
  assert.deepEqual(requests, [{
    url: "https://example.supabase.co/rest/v1/rpc/consume_alliance_action_rate_limit_http",
    body: {
      p_key: "123:global:gift",
      p_window_start: "2026-11-20T09:48:00.000Z",
      p_now: "2026-11-20T09:48:27.000Z",
      p_limit: 5,
    },
  }]);
});
