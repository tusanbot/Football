import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseAdminRoleRepository } from "../src/node-supabase-admin-role.js";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";

function repository(response: unknown) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const client = new SupabaseHttpClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "service-role-key-for-admin-role-tests",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  return { repo: new NodeSupabaseAdminRoleRepository(client), calls };
}

test("admin role repository reads active role assignments through the existing HTTP RPC", async () => {
  const { repo, calls } = repository({ role: "football", active: true });
  assert.deepEqual(await repo.getAssignment("910000001"), { role: "football", active: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /rpc\/get_event_tournament_admin_role_http$/);
  assert.deepEqual(calls[0]!.body, { p_telegram_id: "910000001" });
});

test("admin role repository preserves inactive assignments so environment roles remain revoked", async () => {
  const { repo } = repository({ role: "economy", active: false });
  assert.deepEqual(await repo.getAssignment("910000002"), { role: "economy", active: false });
});

test("admin role repository returns null for an unassigned Telegram account", async () => {
  const { repo } = repository(null);
  assert.equal(await repo.getAssignment("910000003"), null);
});

test("admin role repository rejects malformed identities and malformed RPC responses", async () => {
  const { repo } = repository({ role: "football", active: "yes" });
  await assert.rejects(repo.getAssignment("not-a-telegram-id"), /INVALID_TELEGRAM_ID/);
  await assert.rejects(repo.getAssignment("910000004"), /SUPABASE_ADMIN_ROLE_INVALID_RESPONSE/);
});
