import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseBotRuntimeLeaseRepository } from "../src/node-supabase-bot-runtime-lease.js";
import { SupabaseMatchRuntimeLeaseRepository } from "../src/game/node-supabase-match-runtime-lease.js";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";

const url = "https://example.supabase.co";
const key = "runtime-lease-service-role-test-key";

test("bot lease acquire recovers a committed RPC after a lost HTTP response using the same instance and timestamp", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let owner: string | null = null;
  let expiresAt = 0;
  let durableAcquisitions = 0;
  globalThis.fetch = (async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), body });
    const now = Date.parse(String(body.p_now));
    const instance = String(body.p_instance_id);
    const action = String(body.p_action);
    let result: Record<string, unknown>;
    if (action === "acquire") {
      const acquired = owner === instance || owner === null || expiresAt <= now;
      if (acquired) {
        if (owner !== instance) durableAcquisitions++;
        owner = instance;
        expiresAt = now + 60_000;
      }
      result = { acquired, released: false, leaseExpiresAt: acquired ? new Date(expiresAt).toISOString() : null };
    } else {
      throw new Error("unexpected action");
    }
    if (calls.length === 1) throw new TypeError("socket closed after bot lease commit");
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const repository = new SupabaseBotRuntimeLeaseRepository(new SupabaseHttpClient({ url, serviceRoleKey: key }));
    const instance = "11111111-1111-4111-8111-111111111111";
    const now = "2026-11-20T12:00:00.000Z";
    await assert.rejects(repository.execute(instance, "acquire", now), /Supabase HTTP request failed/);
    assert.equal(calls.length, 1, "lease mutations must not be retried automatically by the transport");
    const recovered = await repository.execute(instance, "acquire", now);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]!.body, calls[0]!.body);
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.leaseExpiresAt, new Date(Date.parse(now) + 60_000).toISOString());
    assert.equal(durableAcquisitions, 1, "same-instance acquire replay must not create a second lease");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("match runtime claim does not auto-retry an ambiguous claim and permits recovery only after lease expiry", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const now = Date.parse("2026-11-20T12:00:00.000Z");
  let durableClaimCount = 0;
  const state: { lease: { token: string; expiresAt: number } | null } = { lease: null };
  globalThis.fetch = (async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), body });
    const requestedNow = Date.parse(String(body.p_now));
    let rows: Array<Record<string, unknown>> = [];
    if (!state.lease || state.lease.expiresAt <= requestedNow) {
      durableClaimCount++;
      state.lease = { token: "lease-token-" + durableClaimCount, expiresAt: requestedNow + Number(body.p_lease_ms) };
      rows = [{
        runtime_id: "runtime-ambiguous-claim",
        lease_token: state.lease.token,
        lease_expires_at: new Date(state.lease.expiresAt).toISOString(),
      }];
    }
    if (calls.length === 1) throw new TypeError("socket closed after match runtime claim commit");
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const repository = new SupabaseMatchRuntimeLeaseRepository(new SupabaseHttpClient({ url, serviceRoleKey: key }));
    const command = { workerId: "worker-ambiguous", now: new Date(now).toISOString(), leaseMs: 60_000, limit: 1 };
    await assert.rejects(repository.claim(command), /Supabase HTTP request failed/);
    assert.equal(calls.length, 1);
    const earlyRetry = await repository.claim(command);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]!.body, calls[0]!.body);
    assert.deepEqual(earlyRetry, [], "an active lease must not be claimed a second time");
    assert.equal(durableClaimCount, 1);
    const recovered = await repository.claim({
      ...command,
      now: new Date(now + 60_001).toISOString(),
    });
    assert.equal(calls.length, 3);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]!.runtime.id, "runtime-ambiguous-claim");
    assert.equal(recovered[0]!.lease.token, "lease-token-2");
    assert.equal(durableClaimCount, 2, "recovery should issue a fresh lease only after expiry");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
