import test from "node:test";
import assert from "node:assert/strict";
import { NodeSupabaseAdminModerationActionsRepository } from "../src/node-supabase-admin-moderation-actions.js";
import type { SupabaseHttpClient } from "../src/node-supabase-http.js";
test("admin moderation actions execute through the Supabase HTTP RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { ok: true, targetType: "user", targetId: "user-1", replay: false }; } } as unknown as SupabaseHttpClient;
  const repo = new NodeSupabaseAdminModerationActionsRepository(client);
  assert.deepEqual(await repo.execute({ action: "suspend-user", targetId: "user-1", actorTelegramId: "123456", idempotencyKey: "moderation-key-001" }), { ok: true, targetType: "user", targetId: "user-1", replay: false });
  assert.equal(calls[0]?.name, "admin_moderation_action_http");
  assert.equal(calls[0]?.args.p_action, "suspend-user");
});
test("admin moderation repository rejects malformed RPC responses", async () => {
  const client = { rpc: async () => ({ ok: false }) } as unknown as SupabaseHttpClient;
  const repo = new NodeSupabaseAdminModerationActionsRepository(client);
  await assert.rejects(repo.execute({ action: "restore-user", targetId: "user-1", actorTelegramId: "123456", idempotencyKey: "moderation-key-002" }), /SUPABASE_ADMIN_MODERATION_INVALID_RESPONSE/);
});
