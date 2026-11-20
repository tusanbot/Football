import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminConsoleReadRepository } from "../src/repositories/admin-console-read.js";

function repository(responses: unknown[]) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return responses.shift(); } } as never;
  return { repo: new SupabaseAdminConsoleReadRepository(client), calls };
}
const counts = Object.fromEntries(["users","clubs","players","groups","challenges","leagues","items","giftCodes","flags","alliances","matches","walletTransactions","groupTransactions"].map((key) => [key, 0]));

test("admin console overview and group targets reuse the existing read RPC", async () => {
  const { repo, calls } = repository([{ counts }, { groups: [{ telegramId: "-100123", title: "League" }] }]);
  assert.deepEqual(await repo.overview(), { counts });
  assert.deepEqual(await repo.groupTargets(), { groups: [{ telegramId: "-100123", title: "League" }] });
  assert.deepEqual(calls, [
    { name: "get_admin_console_read_http", args: { p_view: "overview" } },
    { name: "get_admin_console_read_http", args: { p_view: "group-targets" } },
  ]);
});

test("admin finance summary validates period and reuses existing RPC", async () => {
  const summary = { days: 30, from: "2026-10-01", clubArrearsTotal: "0", wallet: [], clubFinance: [], groupPoints: [], walletReconciliation: [], groupReconciliation: [], clubFinanceSummary: [] };
  const { repo, calls } = repository([summary]);
  assert.deepEqual(await repo.financeSummary(30), summary);
  assert.deepEqual(calls, [{ name: "get_admin_finance_summary_http", args: { p_days: 30 } }]);
  await assert.rejects(repo.financeSummary(0), /INVALID_FINANCE_PERIOD/);
});

test("admin broadcasts and ledgers reuse existing read RPCs", async () => {
  const broadcast = { id: "b-1", kind: "groups", name: "Notice", createdByTelegramId: "123", createdAt: "2026-11-20", total: 1, delivered: 1, skipped: 0, failed: 0, pending: 0 };
  const ledger = { id: "l-1", createdAt: "2026-11-20", actorTelegramId: "123", action: "adjust", targetType: "user", targetId: "456" };
  const { repo, calls } = repository([[broadcast], [ledger]]);
  assert.deepEqual(await repo.broadcasts(20), [broadcast]);
  assert.deepEqual(await repo.ledgerEntries("audit", 10, "test"), [ledger]);
  assert.deepEqual(calls, [
    { name: "get_admin_broadcasts_http", args: { p_limit: 20 } },
    { name: "get_admin_ledger_entries_http", args: { p_resource: "audit", p_limit: 10, p_query: "test" } },
  ]);
});

test("admin console rejects malformed RPC data", async () => {
  const { repo } = repository([{ counts: {} }, { groups: [{ telegramId: "x" }] }, { days: 7 }]);
  await assert.rejects(repo.overview(), /SUPABASE_ADMIN_CONSOLE_INVALID_OVERVIEW/);
  await assert.rejects(repo.groupTargets(), /SUPABASE_ADMIN_CONSOLE_INVALID_GROUP_TARGET/);
  await assert.rejects(repo.financeSummary(7), /SUPABASE_ADMIN_CONSOLE_INVALID_FINANCE_SUMMARY/);
});
