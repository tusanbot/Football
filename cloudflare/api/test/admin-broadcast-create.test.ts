import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminBroadcastCreateRepository } from "../src/repositories/admin-broadcast-create.js";
function repository(response: unknown) {
 const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
 const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return response; } } as never;
 return { repo: new SupabaseAdminBroadcastCreateRepository(client), calls };
}
test("Worker admin broadcast create adapter calls the shared RPC", async () => {
 const { repo, calls } = repository({ ok: true, kind: "groups", targetId: "group-broadcast-1", recipients: 3, replay: false });
 assert.equal((await repo.create("groups", "Group notice", "910000001", "broadcast-groups-01")).recipients, 3);
 assert.equal(calls[0]?.name, "admin_broadcast_create_http");
});
test("Worker admin broadcast create adapter rejects malformed response", async () => {
 const { repo } = repository({ ok: true });
 await assert.rejects(repo.create("users", "User notice", "910000001", "broadcast-users-01"), /SUPABASE_ADMIN_BROADCAST_CREATE_INVALID_RESPONSE/);
});
