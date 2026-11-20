import test from "node:test";
import assert from "node:assert/strict";
import { NodeSupabaseAdminBroadcastManagementRepository } from "../src/node-supabase-admin-broadcast-management.js";
import type { SupabaseHttpClient } from "../src/node-supabase-http.js";
test("admin broadcast retry uses the idempotent Supabase RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { ok: true, retried: 3, replayed: false }; } } as unknown as SupabaseHttpClient;
  const repo = new NodeSupabaseAdminBroadcastManagementRepository(client);
  assert.deepEqual(await repo.retry("groups", "broadcast-1", "123456", "broadcast-retry-key1"), { retried: 3, replayed: false });
  assert.equal(calls[0]?.name, "admin_broadcast_retry_http");
  assert.equal(calls[0]?.args.p_kind, "groups");
});
test("admin broadcast retry rejects malformed RPC responses", async () => {
  const client = { rpc: async () => ({ ok: false }) } as unknown as SupabaseHttpClient;
  const repo = new NodeSupabaseAdminBroadcastManagementRepository(client);
  await assert.rejects(repo.retry("users", "broadcast-1", "123456", "broadcast-retry-key2"), /SUPABASE_ADMIN_BROADCAST_RETRY_INVALID_RESPONSE/);
});
