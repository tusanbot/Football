import { describe, expect, it, vi } from "vitest";
import { NodeSupabaseAdminConsoleReadRepository } from "../src/node-supabase-admin-console-read.js";
import type { SupabaseHttpClient } from "../src/node-supabase-http.js";

function clientWith(result: unknown) {
  return { rpc: vi.fn().mockResolvedValue(result) } as unknown as SupabaseHttpClient;
}
describe("NodeSupabaseAdminConsoleReadRepository", () => {
  it("reads overview counts through the Supabase HTTP RPC", async () => {
    const counts = Object.fromEntries(["users","clubs","players","groups","challenges","leagues","items","giftCodes","flags","alliances","matches","walletTransactions","groupTransactions"].map((key) => [key, 1]));
    const client = clientWith({ counts });
    const repo = new NodeSupabaseAdminConsoleReadRepository(client);
    await expect(repo.overview()).resolves.toEqual({ counts });
    expect((client as unknown as {rpc:ReturnType<typeof vi.fn>}).rpc).toHaveBeenCalledWith("get_admin_console_read_http", { p_view: "overview" });
  });
  it("rejects malformed overview responses", async () => {
    const repo = new NodeSupabaseAdminConsoleReadRepository(clientWith({ counts: { users: "1" } }));
    await expect(repo.overview()).rejects.toThrow("SUPABASE_ADMIN_CONSOLE_INVALID_OVERVIEW");
  });
  it("reads finance summary with a bounded period", async () => {
    const summary = { days: 30, from: "2026-11-01T00:00:00.000Z", wallet: [], clubFinance: [], groupPoints: [], walletReconciliation: [], groupReconciliation: [], clubFinanceSummary: [], clubArrearsTotal: "0" };
    const client = clientWith(summary);
    const repo = new NodeSupabaseAdminConsoleReadRepository(client);
    await expect(repo.financeSummary(30)).resolves.toEqual(summary);
    expect((client as unknown as {rpc:ReturnType<typeof vi.fn>}).rpc).toHaveBeenCalledWith("get_admin_finance_summary_http", { p_days: 30 });
  });
  it("rejects invalid finance periods and malformed finance responses", async () => {
    const repo = new NodeSupabaseAdminConsoleReadRepository(clientWith({ days: 30 }));
    await expect(repo.financeSummary(0)).rejects.toThrow("INVALID_FINANCE_PERIOD");
    await expect(repo.financeSummary(30)).rejects.toThrow("SUPABASE_ADMIN_CONSOLE_INVALID_FINANCE_SUMMARY");
  });
  it("reads active group targets and validates their shape", async () => {
    const client = clientWith({ groups: [{ telegramId: "-100123", title: "Football group" }] });
    const repo = new NodeSupabaseAdminConsoleReadRepository(client);
    await expect(repo.groupTargets()).resolves.toEqual({ groups: [{ telegramId: "-100123", title: "Football group" }] });
  });
  it("rejects malformed group targets", async () => {
    const repo = new NodeSupabaseAdminConsoleReadRepository(clientWith({ groups: [{ telegramId: 1 }] }));
    await expect(repo.groupTargets()).rejects.toThrow("SUPABASE_ADMIN_CONSOLE_INVALID_GROUP_TARGET");
  });
});
