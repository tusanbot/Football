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

test("admin ledger entries read all supported ledger resources through bounded Supabase HTTP RPC", async () => {
  const rows = [{ id: "row-1", createdAt: "2026-11-20T10:00:00.000Z", asset: "CASH", direction: "CREDIT", amount: "25", reason: "test", user: { telegramId: "123", displayName: "Player", username: null } }];
  const { client, calls } = clientWith(rows);
  const repo = new NodeSupabaseAdminConsoleReadRepository(client);
  assert.deepEqual(await repo.ledgerEntries("wallet-ledger", 20, "Player"), rows);
  assert.deepEqual(calls[0], { name: "get_admin_ledger_entries_http", args: { p_resource: "wallet-ledger", p_limit: 20, p_query: "Player" } });
  const groupRows = [{ id: "row-2", createdAt: "2026-11-20T10:00:00.000Z", amount: "10", source: "ADMIN_ADJUSTMENT", description: "test", group: { title: "Group", telegramId: "-1001" }, user: null }];
  const groupRepo = new NodeSupabaseAdminConsoleReadRepository(clientWith(groupRows).client);
  assert.deepEqual(await groupRepo.ledgerEntries("group-ledger", 10), groupRows);
  const auditRows = [{ id: "audit-1", createdAt: "2026-11-20T10:00:00.000Z", actorTelegramId: "123", action: "test", targetType: "user", targetId: "u1" }];
  const auditRepo = new NodeSupabaseAdminConsoleReadRepository(clientWith(auditRows).client);
  assert.deepEqual(await auditRepo.ledgerEntries("audit", 5), auditRows);
});
test("admin ledger entries reject invalid limits, queries and malformed responses", async () => {
  const repo = new NodeSupabaseAdminConsoleReadRepository(clientWith([]).client);
  await assert.rejects(repo.ledgerEntries("wallet-ledger", 0), /INVALID_ADMIN_LEDGER_LIMIT/);
  await assert.rejects(repo.ledgerEntries("audit", 10, "x".repeat(101)), /INVALID_ADMIN_LEDGER_QUERY/);
  const malformed = new NodeSupabaseAdminConsoleReadRepository(clientWith([{ id: "x", createdAt: "now" }]).client);
  await assert.rejects(malformed.ledgerEntries("wallet-ledger", 10), /SUPABASE_ADMIN_LEDGER_INVALID_ROW/);
  const invalidResponse = new NodeSupabaseAdminConsoleReadRepository(clientWith({ rows: [] }).client);
  await assert.rejects(invalidResponse.ledgerEntries("audit", 10), /SUPABASE_ADMIN_LEDGER_INVALID_RESPONSE/);
});

test("admin resource lists use the allowlisted Supabase RPC with bounded filters", async () => {
  const rows = [{ id: "club-1", name: "Tosan", owner: { telegramId: "123", displayName: "Owner" }, _count: { players: 1, homeMatches: 2, awayMatches: 1 } }];
  const { client, calls } = clientWith(rows);
  const repo = new NodeSupabaseAdminConsoleReadRepository(client);
  assert.deepEqual(await repo.resourceList("clubs", 25, "Tosan", 2040), rows);
  assert.deepEqual(calls[0], { name: "get_admin_resource_list_http", args: { p_resource: "clubs", p_limit: 25, p_query: "Tosan", p_season: 2040 } });
  await assert.rejects(repo.resourceList("clubs", 0), /INVALID_ADMIN_RESOURCE_LIMIT/);
  await assert.rejects(repo.resourceList("users", 10, "x".repeat(101)), /INVALID_ADMIN_RESOURCE_QUERY/);
  await assert.rejects(repo.resourceList("users", 10, undefined, 2019), /INVALID_ADMIN_RESOURCE_SEASON/);
  const malformed = new NodeSupabaseAdminConsoleReadRepository(clientWith([{ name: "missing-id" }]).client);
  await assert.rejects(malformed.resourceList("clubs", 10), /SUPABASE_ADMIN_RESOURCE_INVALID_ROW/);
});
