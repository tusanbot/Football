import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseAdminBroadcastCreateRepository } from "../src/node-supabase-admin-broadcast-create.js";
function repository(response: unknown) {
 const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
 const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return response; } } as never;
 return { repo: new NodeSupabaseAdminBroadcastCreateRepository(client), calls };
}
test("user and group broadcasts share the atomic creation RPC", async () => {
 const users = repository({ ok: true, kind: "users", targetId: "user-broadcast-1", recipients: 5, replay: false });
 assert.deepEqual(await users.repo.create("users", "  Hello users  ", "910000001", "broadcast-users-01"), { ok: true, kind: "users", targetId: "user-broadcast-1", recipients: 5, replay: false });
 assert.deepEqual(users.calls[0], { name: "admin_broadcast_create_http", args: { p_kind: "users", p_message: "Hello users", p_actor_telegram_id: "910000001", p_idempotency_key: "broadcast-users-01" } });
 const groups = repository({ ok: true, kind: "groups", targetId: "group-broadcast-1", recipients: 2, replay: true });
 assert.equal((await groups.repo.create("groups", "Hello groups", "910000002", "broadcast-groups-01")).replay, true);
});
test("broadcast create adapter validates inputs and RPC response", async () => {
 const invalid = repository({});
 await assert.rejects(invalid.repo.create("users", "x", "bad", "short"), /INVALID_ADMIN_BROADCAST/);
 const malformed = repository({ ok: true, kind: "users", targetId: "id", recipients: 0, replay: false });
 await assert.rejects(malformed.repo.create("users", "Hello", "910000001", "broadcast-users-02"), /SUPABASE_ADMIN_BROADCAST_CREATE_INVALID_RESPONSE/);
});
