import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/supabase-http.js";
import { SupabaseBotRuntimeLeaseRepository } from "../src/repositories/bot-runtime-lease.js";

test("Bot runtime lease repository sends atomic lease action to Supabase RPC", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-key-for-bot-runtime-lease",
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        acquired: true, released: false, leaseExpiresAt: "2026-11-19T12:01:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const repository = new SupabaseBotRuntimeLeaseRepository(client);
  const result = await repository.execute(
    "11111111-1111-4111-8111-111111111111", "acquire", "2026-11-19T12:00:00.000Z",
  );
  assert.deepEqual(result, {
    acquired: true, released: false, leaseExpiresAt: "2026-11-19T12:01:00.000Z",
  });
  assert.deepEqual(requestBody, {
    p_instance_id: "11111111-1111-4111-8111-111111111111",
    p_action: "acquire", p_now: "2026-11-19T12:00:00.000Z", p_lease_seconds: 60,
  });
});

test("Bot runtime lease repository rejects malformed RPC responses", async () => {
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-key-for-bot-runtime-lease",
    fetchImpl: async () => new Response(JSON.stringify({ acquired: "yes" }), { status: 200 }),
  });
  const repository = new SupabaseBotRuntimeLeaseRepository(client);
  await assert.rejects(
    repository.execute("11111111-1111-4111-8111-111111111111", "heartbeat", "2026-11-19T12:00:00.000Z"),
    /SUPABASE_BOT_RUNTIME_LEASE_INVALID_RESPONSE/,
  );
});
