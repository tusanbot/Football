import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseHttpClient, SupabaseHttpError } from "../src/supabase-http.js";

const config = {
  url: "https://example-project.supabase.co",
  serviceRoleKey: "service-role-key-that-is-long-enough-for-tests",
};

test("Supabase client sends authenticated HTTPS PostgREST requests", async () => {
  let captured: { url: URL; init: RequestInit } | undefined;
  const client = new SupabaseHttpClient({
    ...config,
    fetchImpl: async (input, init) => {
      captured = { url: new URL(String(input)), init: init ?? {} };
      return new Response(JSON.stringify([{ id: "row-1" }]), { status: 200 });
    },
  });
  const rows = await client.select<Array<{ id: string }>>("clubs", { select: "id", id: "eq.club-1" });
  assert.deepEqual(rows, [{ id: "row-1" }]);
  assert.equal(captured?.url.protocol, "https:");
  assert.equal(captured?.url.pathname, "/rest/v1/clubs");
  assert.equal(captured?.url.searchParams.get("id"), "eq.club-1");
  const headers = new Headers(captured?.init.headers);
  assert.equal(headers.get("apikey"), config.serviceRoleKey);
  assert.equal(headers.get("authorization"), "Bearer " + config.serviceRoleKey);
  assert.equal(captured?.init.method, "GET");
  assert.equal(captured?.init.redirect, "error");
});

test("RPC calls use PostgREST RPC endpoint and JSON arguments", async () => {
  let captured: { url: URL; init: RequestInit } | undefined;
  const client = new SupabaseHttpClient({
    ...config,
    fetchImpl: async (input, init) => {
      captured = { url: new URL(String(input)), init: init ?? {} };
      return new Response(JSON.stringify({ applied: true }), { status: 200 });
    },
  });
  const result = await client.rpc<{ applied: boolean }>("wallet_apply_delta", { p_user_id: "u1", p_amount: "10" });
  assert.deepEqual(result, { applied: true });
  assert.equal(captured?.url.pathname, "/rest/v1/rpc/wallet_apply_delta");
  assert.deepEqual(JSON.parse(String(captured?.init.body)), { p_user_id: "u1", p_amount: "10" });
});

test("mutations request representation and are never automatically retried", async () => {
  let calls = 0;
  const client = new SupabaseHttpClient({
    ...config,
    fetchImpl: async (_input, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("prefer"), "return=representation");
      return new Response(JSON.stringify({ message: "constraint violation", code: "23514" }), { status: 409 });
    },
  });
  await assert.rejects(client.insert("wallets", { user_id: "u1" }), (error: unknown) => {
    assert.ok(error instanceof SupabaseHttpError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "23514");
    return true;
  });
  assert.equal(calls, 1);
});

test("client rejects non-HTTPS, non-Supabase and credential-bearing URLs", () => {
  for (const url of [
    "http://example-project.supabase.co",
    "https://supabase.co",
    "https://example-project.supabase.co.attacker.invalid",
    "https://nested.example-project.supabase.co",
    "https://example-project.supabase.co:8443",
    "https://example-project.supabase.co/proxy",
    "https://user:pass@example-project.supabase.co",
  ]) assert.throws(() => new SupabaseHttpClient({ ...config, url }));
});

test("client preserves quoted Prisma-style table names for PostgREST resources", async () => {
  let requestedPath = "";
  const client = new SupabaseHttpClient({
    ...config,
    fetchImpl: async (input) => {
      requestedPath = new URL(String(input)).pathname;
      return new Response("[]", { status: 200 });
    },
  });
  await client.insert("PilotAnalyticsEvent", { eventName: "bot_start" });
  assert.equal(requestedPath, "/rest/v1/PilotAnalyticsEvent");
});

test("client rejects unsafe identifiers and malformed configuration", async () => {
  const client = new SupabaseHttpClient({
    ...config, fetchImpl: async () => new Response("[]", { status: 200 }),
  });
  await assert.rejects(client.select("clubs;drop_table_users", { select: "*" }), TypeError);
  await assert.rejects(client.rpc("wallet_apply_delta;--", {}), TypeError);
  assert.throws(() => new SupabaseHttpClient({ ...config, serviceRoleKey: "short" }));
  assert.throws(() => new SupabaseHttpClient({ ...config, timeoutMs: 99 }));
});
