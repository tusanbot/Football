import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminConfigurationRepository } from "../src/repositories/admin-configuration.js";

function repository(responses: unknown[]) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return responses.shift();
  } } as never;
  return { repo: new SupabaseAdminConfigurationRepository(client), calls };
}

test("Cloudflare admin configuration list reuses the existing protected RPC", async () => {
  const { repo, calls } = repository([{ roles: [], settings: [] }]);
  assert.deepEqual(await repo.list(), { roles: [], settings: [] });
  assert.deepEqual(calls, [{ name: "get_admin_configuration_http", args: {} }]);
});

test("Cloudflare admin configuration actions use the existing atomic RPC", async () => {
  const { repo, calls } = repository([{ ok: true, targetType: "admin-role", targetId: "123456", replay: false }]);
  const result = await repo.execute({
    action: "set-admin-role", actorTelegramId: "987654", idempotencyKey: "stable-admin-key-001",
    adminTelegramId: "123456", adminRole: "moderator",
  });
  assert.equal(calls[0]?.name, "admin_configuration_action_http");
  assert.deepEqual(calls[0]?.args, {
    p_action: "set-admin-role", p_actor_telegram_id: "987654", p_idempotency_key: "admin-config:stable-admin-key-001",
    p_target_telegram_id: "123456", p_role: "moderator", p_setting_key: null, p_setting_value: null, p_setting_description: null,
  });
  assert.equal(result.replay, false);
});

test("Cloudflare admin configuration validates list and action RPC responses", async () => {
  const { repo } = repository([{ roles: {} }, { ok: true, targetId: "123456" }]);
  await assert.rejects(repo.list(), /SUPABASE_ADMIN_CONFIGURATION_INVALID_RESPONSE/);
  await assert.rejects(repo.execute({
    action: "revoke-admin-role", actorTelegramId: "987654", idempotencyKey: "stable-admin-key-002",
    adminTelegramId: "123456",
  }), /SUPABASE_ADMIN_CONFIGURATION_INVALID_RESPONSE/);
});

test("Cloudflare admin configuration rejects malformed actor Telegram IDs", async () => {
  const { repo } = repository([]);
  await assert.rejects(repo.execute({
    action: "revoke-admin-role", actorTelegramId: "bad", idempotencyKey: "stable-admin-key-003",
    adminTelegramId: "123456",
  }), /INVALID_TELEGRAM_ID/);
});
