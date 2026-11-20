import test from "node:test";
import assert from "node:assert/strict";
import { NodeSupabaseAdminConsoleReadRepository } from "../src/node-supabase-admin-console-read.js";
import type { SupabaseHttpClient } from "../src/node-supabase-http.js";

function clientWith(result: unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return { client: { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return result; } } as unknown as SupabaseHttpClient, calls };
}
test("admin console overview reads validated counts through Supabase HTTP", async () => {
  const counts = Object.fromEntries(["users","clubs","players","groups","challenges","leagues","items","giftCodes","flags","alliances","matches","walletTransactions","groupTransactions"].map((key) => [key, 1]));
  const { client, calls } = clientWith({ counts });
  const repo = new NodeSupabaseAdminConsoleReadRepository(client);
  assert.deepEqual(await repo.overview(), { counts });
  assert.deepEqual(calls[0], { name: "get_admin_console_read_http", args: { p_view: "overview" } });
});
test("admin console overview rejects malformed responses", async () => {
  const repo = new NodeSupabaseAdminConsoleReadRepository(clientWith({ counts: { users: "1" } }).client);
  await assert.rejects(repo.overview(), /SUPABASE_ADMIN_CONSOLE_INVALID_OVERVIEW/);
});
test("admin finance summary reads a bounded period", async () => {
  const summary = { days: 30, from: "2026-11-01T00:00:00.000Z", wallet: [], clubFinance: [], groupPoints: [], walletReconciliation: [], groupReconciliation: [], clubFinanceSummary: [], clubArrearsTotal: "0" };
  const { client, calls } = clientWith(summary);
  const repo = new NodeSupabaseAdminConsoleReadRepository(client);
  assert.deepEqual(await repo.financeSummary(30), summary);
  assert.deepEqual(calls[0], { name: "get_admin_finance_summary_http", args: { p_days: 30 } });
});
test("admin finance summary rejects invalid periods and malformed responses", async () => {
  const repo = new NodeSupabaseAdminConsoleReadRepository(clientWith({ days: 30 }).client);
  await assert.rejects(repo.financeSummary(0), /INVALID_FINANCE_PERIOD/);
  await assert.rejects(repo.financeSummary(30), /SUPABASE_ADMIN_CONSOLE_INVALID_FINANCE_SUMMARY/);
});
test("admin group targets are validated", async () => {
  const repo = new NodeSupabaseAdminConsoleReadRepository(clientWith({ groups: [{ telegramId: "-100123", title: "Football group" }] }).client);
  assert.deepEqual(await repo.groupTargets(), { groups: [{ telegramId: "-100123", title: "Football group" }] });
  const invalid = new NodeSupabaseAdminConsoleReadRepository(clientWith({ groups: [{ telegramId: 1 }] }).client);
  await assert.rejects(invalid.groupTargets(), /SUPABASE_ADMIN_CONSOLE_INVALID_GROUP_TARGET/);
});

test("admin broadcasts read through bounded Supabase HTTP RPC", async () => {
  const rows = [{ id: "b1", kind: "groups", name: "Group broadcast", createdByTelegramId: "123", createdAt: "2026-11-20T10:00:00.000Z", total: 4, delivered: 2, skipped: 1, failed: 1, pending: 0 }];
  const { client, calls } = clientWith(rows);
  const repo = new NodeSupabaseAdminConsoleReadRepository(client);
  assert.deepEqual(await repo.broadcasts(25), rows);
  assert.deepEqual(calls[0], { name: "get_admin_broadcasts_http", args: { p_limit: 25 } });
});
test("admin broadcasts reject invalid limits and malformed rows", async () => {
  const invalidLimit = new NodeSupabaseAdminConsoleReadRepository(clientWith([]).client);
  await assert.rejects(invalidLimit.broadcasts(0), /INVALID_BROADCAST_LIMIT/);
  const malformed = new NodeSupabaseAdminConsoleReadRepository(clientWith([{ id: "b1", kind: "other" }]).client);
  await assert.rejects(malformed.broadcasts(10), /SUPABASE_ADMIN_CONSOLE_INVALID_BROADCAST/);
});
