import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminBroadcastManagementRepository } from "../src/repositories/admin-broadcast-management.js";

function repository(response: unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return response; } } as never;
  return { repo: new SupabaseAdminBroadcastManagementRepository(client), calls };
}

test("admin group broadcast retry reuses the existing atomic RPC", async () => {
  const { repo, calls } = repository({ ok: true, retried: 3, replayed: false });
  assert.deepEqual(await repo.retry("groups", "broadcast-123", "910000001", "stable-retry-key-001"), { retried: 3, replayed: false });
  assert.deepEqual(calls, [{
    name: "admin_broadcast_retry_http",
    args: { p_kind: "groups", p_target_id: "broadcast-123", p_actor_telegram_id: "910000001", p_idempotency_key: "admin-group-broadcast-retry:stable-retry-key-001" },
  }]);
});

test("admin user broadcast retry namespaces idempotency and validates input and response", async () => {
  const { repo, calls } = repository({ ok: true, retried: 0, replayed: true });
  assert.deepEqual(await repo.retry("users", "broadcast-456", "910000002", "stable-retry-key-002"), { retried: 0, replayed: true });
  assert.equal(calls[0]?.args.p_idempotency_key, "admin-user-broadcast-retry:stable-retry-key-002");
  await assert.rejects(repo.retry("groups", "x", "bad", "short"), /INVALID_BROADCAST_RETRY/);
  const invalid = repository({ ok: true, retried: -1, replayed: false });
  await assert.rejects(invalid.repo.retry("groups", "broadcast-789", "910000003", "stable-retry-key-003"), /SUPABASE_ADMIN_BROADCAST_RETRY_INVALID_RESPONSE/);
});
