import { SupabaseHttpClient } from "./node-supabase-http.js";

export interface AdminConsoleOverview {
  counts: Record<"users"|"clubs"|"players"|"groups"|"challenges"|"leagues"|"items"|"giftCodes"|"flags"|"alliances"|"matches"|"walletTransactions"|"groupTransactions", number>;
}
export interface AdminConsoleGroupTarget { telegramId: string; title: string; }
export interface AdminConsoleReadPort {
  overview(): Promise<AdminConsoleOverview>;
  groupTargets(): Promise<{ groups: AdminConsoleGroupTarget[] }>;
  financeSummary(days: number): Promise<Record<string, unknown>>;
  broadcasts(limit: number): Promise<Array<Record<string, unknown>>>;
  ledgerEntries(resource: "wallet-ledger" | "group-ledger" | "audit", limit: number, query?: string): Promise<Array<Record<string, unknown>>>;
}
export class NodeSupabaseAdminConsoleReadRepository implements AdminConsoleReadPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async broadcasts(limit: number): Promise<Array<Record<string, unknown>>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_BROADCAST_LIMIT");
    const result = await this.client.rpc<unknown>("get_admin_broadcasts_http", { p_limit: limit });
    if (!Array.isArray(result)) throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_BROADCASTS");
    for (const row of result) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_BROADCAST");
      const value = row as Record<string, unknown>;
      if (typeof value.id !== "string" || !["groups", "users"].includes(String(value.kind)) || typeof value.name !== "string" || typeof value.createdByTelegramId !== "string" || typeof value.createdAt !== "string" || ["total", "delivered", "skipped", "failed", "pending"].some((key) => !Number.isSafeInteger(value[key]) || Number(value[key]) < 0)) throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_BROADCAST");
    }
    return result as Array<Record<string, unknown>>;
  }
  async ledgerEntries(resource: "wallet-ledger" | "group-ledger" | "audit", limit: number, query?: string): Promise<Array<Record<string, unknown>>> {
    if (!["wallet-ledger", "group-ledger", "audit"].includes(resource)) throw new Error("INVALID_ADMIN_LEDGER_RESOURCE");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_ADMIN_LEDGER_LIMIT");
    if (query !== undefined && (typeof query !== "string" || query.length > 100)) throw new Error("INVALID_ADMIN_LEDGER_QUERY");
    const result = await this.client.rpc<unknown>("get_admin_ledger_entries_http", {
      p_resource: resource, p_limit: limit, p_query: query?.trim() || null,
    });
    if (!Array.isArray(result)) throw new Error("SUPABASE_ADMIN_LEDGER_INVALID_RESPONSE");
    for (const row of result) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("SUPABASE_ADMIN_LEDGER_INVALID_ROW");
      const value = row as Record<string, unknown>;
      const commonValid = typeof value.id === "string" && typeof value.createdAt === "string";
      const resourceValid = resource === "wallet-ledger"
        ? typeof value.asset === "string" && typeof value.direction === "string" && typeof value.amount === "string"
          && typeof value.reason === "string" && !!value.user && typeof value.user === "object"
        : resource === "group-ledger"
          ? typeof value.amount === "string" && typeof value.source === "string" && typeof value.description === "string"
            && !!value.group && typeof value.group === "object"
          : typeof value.actorTelegramId === "string" && typeof value.action === "string"
            && typeof value.targetType === "string" && typeof value.targetId === "string";
      if (!commonValid || !resourceValid) throw new Error("SUPABASE_ADMIN_LEDGER_INVALID_ROW");
    }
    return result as Array<Record<string, unknown>>;
  }
  async overview(): Promise<AdminConsoleOverview> {
    const result = await this.client.rpc<Record<string, unknown>>("get_admin_console_read_http", { p_view: "overview" });
    if (!result || !result.counts || typeof result.counts !== "object" || Array.isArray(result.counts)) {
      throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_OVERVIEW");
    }
    const counts = result.counts as Record<string, unknown>;
    const keys = ["users","clubs","players","groups","challenges","leagues","items","giftCodes","flags","alliances","matches","walletTransactions","groupTransactions"] as const;
    for (const key of keys) if (!Number.isSafeInteger(counts[key]) || Number(counts[key]) < 0) {
      throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_OVERVIEW");
    }
    return { counts: counts as AdminConsoleOverview["counts"] };
  }
  async financeSummary(days: number): Promise<Record<string, unknown>> {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("INVALID_FINANCE_PERIOD");
    const result = await this.client.rpc<Record<string, unknown>>("get_admin_finance_summary_http", { p_days: days });
    const arrays = ["wallet","clubFinance","groupPoints","walletReconciliation","groupReconciliation","clubFinanceSummary"];
    if (!result || result.days !== days || typeof result.from !== "string" || typeof result.clubArrearsTotal !== "string" || arrays.some((key) => !Array.isArray(result[key]))) {
      throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_FINANCE_SUMMARY");
    }
    return result;
  }
  async groupTargets(): Promise<{ groups: AdminConsoleGroupTarget[] }> {
    const result = await this.client.rpc<Record<string, unknown>>("get_admin_console_read_http", { p_view: "group-targets" });
    if (!result || !Array.isArray(result.groups)) throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_GROUP_TARGETS");
    const groups = result.groups.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_GROUP_TARGET");
      const value = row as Record<string, unknown>;
      if (typeof value.telegramId !== "string" || typeof value.title !== "string") throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_GROUP_TARGET");
      return { telegramId: value.telegramId, title: value.title };
    });
    return { groups };
  }
}
