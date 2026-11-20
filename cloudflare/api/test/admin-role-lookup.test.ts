import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminRoleLookupRepository } from "../src/repositories/admin-role-lookup.js";

function repository(response: unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return response;
  } } as never;
  return { repo: new SupabaseAdminRoleLookupRepository(client), calls };
}

test("Cloudflare admin role lookup reuses the existing Supabase HTTP RPC", async () => {
  const { repo, calls } = repository({ role: "football", active: true });
  assert.deepEqual(await repo.getAssignment("910000001"), { role: "football", active: true });
  assert.deepEqual(calls, [{
    name: "get_event_tournament_admin_role_http",
    args: { p_telegram_id: "910000001" },
  }]);
});

test("Cloudflare admin role lookup preserves inactive assignments", async () => {
  const { repo } = repository({ role: "economy", active: false });
  assert.deepEqual(await repo.getAssignment("910000002"), { role: "economy", active: false });
});

test("Cloudflare admin role lookup returns null for an unassigned account", async () => {
  const { repo } = repository(null);
  assert.equal(await repo.getAssignment("910000003"), null);
});

test("Cloudflare admin role lookup rejects malformed identities and RPC responses", async () => {
  const { repo } = repository({ role: "football", active: "yes" });
  await assert.rejects(repo.getAssignment("not-a-telegram-id"), /INVALID_TELEGRAM_ID/);
  await assert.rejects(repo.getAssignment("910000004"), /SUPABASE_ADMIN_ROLE_INVALID_RESPONSE/);
});
