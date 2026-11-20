import type { AdminConsoleReadPort } from "../../../../apps/api/src/node-supabase-admin-console-read.js";
import { SupabaseHttpClient } from "../supabase-http.js";

export class SupabaseAdminConsoleReadRepository implements AdminConsoleReadPort {
  async resourceList(resource: import("../../../../apps/api/src/node-supabase-admin-console-read.js").AdminResourceListName, limit: number, query?: string, season?: number) {
    if (!["players", "clubs", "users", "groups", "challenges", "leagues", "items", "gift-codes", "alliances", "matches", "alliance-seasons", "season-awards"].includes(resource)) throw new Error("INVALID_ADMIN_RESOURCE");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_ADMIN_RESOURCE_LIMIT");
    if (query !== undefined && (typeof query !== "string" || query.length > 100)) throw new Error("INVALID_ADMIN_RESOURCE_QUERY");
    if (season !== undefined && (!Number.isInteger(season) || season < 2020 || season > 2200)) throw new Error("INVALID_ADMIN_RESOURCE_SEASON");
    const result = await this.client.rpc<unknown>("get_admin_resource_list_http", { p_resource: resource, p_limit: limit, p_query: query?.trim() || null, p_season: season ?? null });
    if (!Array.isArray(result)) throw new Error("SUPABASE_ADMIN_RESOURCE_INVALID_RESPONSE");
    for (const row of result) if (!row || typeof row !== "object" || Array.isArray(row) || typeof (row as Record<string, unknown>).id !== "string") throw new Error("SUPABASE_ADMIN_RESOURCE_INVALID_ROW");
    return result as Array<Record<string, unknown>>;
  }

  constructor(private readonly client: SupabaseHttpClient) {}

  async overview() {
    const result = await this.client.rpc<Record<string, unknown>>("get_admin_console_read_http", { p_view: "overview" });
    if (!result || !result.counts || typeof result.counts !== "object" || Array.isArray(result.counts)) {
      throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_OVERVIEW");
    }
    const counts = result.counts as Record<string, unknown>;
    const keys = ["users", "clubs", "players", "groups", "challenges", "leagues", "items", "giftCodes", "flags", "alliances", "matches", "walletTransactions", "groupTransactions"];
    for (const key of keys) if (!Number.isSafeInteger(counts[key]) || Number(counts[key]) < 0) {
      throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_OVERVIEW");
    }
    return { counts: counts as Awaited<ReturnType<AdminConsoleReadPort["overview"]>>["counts"] };
  }

  async groupTargets() {
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

  async financeSummary(days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("INVALID_FINANCE_PERIOD");
    const result = await this.client.rpc<Record<string, unknown>>("get_admin_finance_summary_http", { p_days: days });
    const arrays = ["wallet", "clubFinance", "groupPoints", "walletReconciliation", "groupReconciliation", "clubFinanceSummary"];
    if (!result || result.days !== days || typeof result.from !== "string" || typeof result.clubArrearsTotal !== "string"
      || arrays.some((key) => !Array.isArray(result[key]))) throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_FINANCE_SUMMARY");
    return result;
  }

  async broadcasts(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_BROADCAST_LIMIT");
    const result = await this.client.rpc<unknown>("get_admin_broadcasts_http", { p_limit: limit });
    if (!Array.isArray(result)) throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_BROADCASTS");
    for (const row of result) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_BROADCAST");
      const value = row as Record<string, unknown>;
      if (typeof value.id !== "string" || !["groups", "users"].includes(String(value.kind)) || typeof value.name !== "string"
        || typeof value.createdByTelegramId !== "string" || typeof value.createdAt !== "string"
        || ["total", "delivered", "skipped", "failed", "pending"].some((key) => !Number.isSafeInteger(value[key]) || Number(value[key]) < 0)) {
        throw new Error("SUPABASE_ADMIN_CONSOLE_INVALID_BROADCAST");
      }
    }
    return result as Array<Record<string, unknown>>;
  }

  async ledgerEntries(resource: "wallet-ledger" | "group-ledger" | "audit", limit: number, query?: string) {
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
        ? typeof value.asset === "string" && typeof value.direction === "string" && typeof value.amount === "string" && typeof value.reason === "string" && !!value.user && typeof value.user === "object"
        : resource === "group-ledger"
          ? typeof value.amount === "string" && typeof value.source === "string" && typeof value.description === "string" && !!value.group && typeof value.group === "object"
          : typeof value.actorTelegramId === "string" && typeof value.action === "string" && typeof value.targetType === "string" && typeof value.targetId === "string";
      if (!commonValid || !resourceValid) throw new Error("SUPABASE_ADMIN_LEDGER_INVALID_ROW");
    }
    return result as Array<Record<string, unknown>>;
  }
}
