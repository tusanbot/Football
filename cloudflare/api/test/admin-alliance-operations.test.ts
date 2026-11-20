import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAllianceRepository } from "../src/repositories/alliance.js";

function repository(response: unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return response; } } as never;
  return { repo: new SupabaseAllianceRepository(client), calls };
}

test("admin alliance season methods reuse existing Supabase RPCs", async () => {
  const { repo, calls } = repository({ ok: true });
  await repo.adminStartAllianceSeason({ actorTelegramId: "910000001", allianceId: "alliance-1", durationDays: 30, idempotencyKey: "stable-alliance-admin-001", reason: "start" });
  await repo.adminCloseAllianceSeason({ actorTelegramId: "910000001", seasonId: "season-1", idempotencyKey: "stable-alliance-admin-002", reason: "close" });
  await repo.adminReviewAllianceSeason({ actorTelegramId: "910000001", seasonId: "season-2", decision: "APPROVE", idempotencyKey: "stable-alliance-admin-003" });
  assert.deepEqual(calls, [
    { name: "admin_start_alliance_season_http", args: { p_actor_telegram_id: "910000001", p_alliance_id: "alliance-1", p_duration_days: 30, p_idempotency_key: "stable-alliance-admin-001", p_reason: "start" } },
    { name: "admin_close_alliance_season_http", args: { p_actor_telegram_id: "910000001", p_season_id: "season-1", p_idempotency_key: "stable-alliance-admin-002", p_reason: "close" } },
    { name: "admin_review_alliance_season_http", args: { p_actor_telegram_id: "910000001", p_season_id: "season-2", p_decision: "APPROVE", p_idempotency_key: "stable-alliance-admin-003", p_reason: null } },
  ]);
});

test("admin alliance rate limit uses the existing atomic RPC", async () => {
  const { repo, calls } = repository({ allowed: true });
  assert.equal(await repo.consumeRateLimit({ telegramUserId: "910000001", telegramGroupId: "global", action: "admin-pyramid-actions", limit: 20, now: "2026-11-20T12:00:00.000Z" }), true);
  assert.deepEqual(calls, [{ name: "consume_alliance_action_rate_limit_http", args: { p_telegram_user_id: "910000001", p_telegram_group_id: "global", p_action: "admin-pyramid-actions", p_limit: 20, p_now: "2026-11-20T12:00:00.000Z" } }]);
});
