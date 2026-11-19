import type { StorePurchaseCommand, StorePurchasePort, StorePurchaseResult } from "./store-purchase-context.js";
import type { StoreItemUseCommand, StoreItemUsePort, StoreItemUseResult } from "./store-item-use-context.js";

const PURCHASE_ERRORS = [
  "INVALID_AMOUNT", "INVALID_IDEMPOTENCY_KEY", "INVALID_QUANTITY", "STORE_ITEM_NOT_FOUND",
  "STORE_INVENTORY_OVERFLOW", "WALLET_NOT_FOUND", "INSUFFICIENT_FUNDS", "IDEMPOTENCY_CONFLICT",
  "CONCURRENT_MODIFICATION",
] as const;
const USE_ERRORS = [
  "INVALID_IDEMPOTENCY_KEY", "INVALID_STORE_ITEM_EFFECT", "STORE_ITEM_NOT_FOUND", "IDEMPOTENCY_CONFLICT",
  "CLUB_NOT_FOUND", "PLAYER_NOT_FOUND", "PLAYER_STAT_ALREADY_MAX", "ITEM_NOT_IN_INVENTORY",
  "CONCURRENT_MODIFICATION",
] as const;

type RpcRow = Record<string, unknown>;

class NodeSupabaseStoreRpc {
  private readonly baseUrl: string;
  constructor(url: string, private readonly serviceRoleKey: string, private readonly timeoutMs = 10_000) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\\.supabase\\.co$/i.test(parsed.hostname)
      || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new TypeError("SUPABASE_URL must be a direct HTTPS Supabase project origin");
    }
    if (!serviceRoleKey || serviceRoleKey.trim().length < 20) throw new TypeError("SUPABASE_SERVICE_ROLE_KEY is required");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new RangeError("Invalid Supabase HTTP timeout");
    this.baseUrl = parsed.origin;
  }
  async call(name: string, args: Record<string, unknown>, errors: readonly string[]): Promise<RpcRow[]> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + "/rest/v1/rpc/" + name, {
        method: "POST", redirect: "error",
        headers: {
          apikey: this.serviceRoleKey,
          authorization: "Bearer " + this.serviceRoleKey,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error("Supabase store RPC request failed", { cause: error });
    }
    const body = await response.text();
    let payload: unknown;
    try { payload = body ? JSON.parse(body) : null; }
    catch { throw new Error("Supabase store RPC returned invalid JSON"); }
    if (!response.ok || (payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as RpcRow).error === "string")) {
      const row = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as RpcRow : {};
      const message = [row.message, row.error, row.details].find(value => typeof value === "string") as string | undefined;
      const code = errors.find(candidate => message?.includes(candidate));
      if (code) throw Object.assign(new Error(code), { code });
      throw new Error("Supabase store RPC was rejected (" + response.status + ")");
    }
    if (Array.isArray(payload)) return payload as RpcRow[];
    if (payload && typeof payload === "object") return [payload as RpcRow];
    throw new Error("SUPABASE_STORE_RPC_INVALID_RESPONSE");
  }
}

export class NodeSupabaseStorePurchaseRepository implements StorePurchasePort {
  private readonly rpc: NodeSupabaseStoreRpc;
  constructor(url: string, serviceRoleKey: string, timeoutMs = 10_000) {
    this.rpc = new NodeSupabaseStoreRpc(url, serviceRoleKey, timeoutMs);
  }
  async purchase(input: StorePurchaseCommand): Promise<StorePurchaseResult> {
    const rows = await this.rpc.call("purchase_store_item", {
      p_user_id: input.userId, p_item_key: input.itemKey, p_asset: input.asset,
      p_unit_price: input.unitPrice, p_quantity: input.quantity, p_idempotency_key: input.idempotencyKey,
    }, PURCHASE_ERRORS);
    const row = rows[0];
    if (!row || row.item_key !== input.itemKey || row.purchased_quantity !== input.quantity
      || typeof row.balance !== "string" || !/^-?\\d+$/.test(row.balance)
      || !Number.isInteger(row.inventory) || typeof row.replayed !== "boolean") {
      throw new Error("SUPABASE_STORE_PURCHASE_INVALID_RESPONSE");
    }
    return {
      itemKey: row.item_key as string, quantity: row.purchased_quantity as number,
      balance: row.balance, inventory: row.inventory as number, replayed: row.replayed,
    };
  }
}

export class NodeSupabaseStoreItemUseRepository implements StoreItemUsePort {
  private readonly rpc: NodeSupabaseStoreRpc;
  constructor(url: string, serviceRoleKey: string, timeoutMs = 10_000) {
    this.rpc = new NodeSupabaseStoreRpc(url, serviceRoleKey, timeoutMs);
  }
  async use(input: StoreItemUseCommand): Promise<StoreItemUseResult> {
    const rows = await this.rpc.call("use_store_item", {
      p_user_id: input.userId, p_item_key: input.itemKey, p_player_id: input.playerId,
      p_fitness_delta: input.fitnessDelta, p_morale_delta: input.moraleDelta,
      p_idempotency_key: input.idempotencyKey,
    }, USE_ERRORS);
    const row = rows[0];
    if (!row || row.item_key !== input.itemKey || row.player_id !== input.playerId
      || !Number.isInteger(row.inventory) || typeof row.replayed !== "boolean"
      || (!row.replayed && (!Number.isInteger(row.fitness) || !Number.isInteger(row.morale)))) {
      throw new Error("SUPABASE_STORE_ITEM_USE_INVALID_RESPONSE");
    }
    return {
      itemKey: row.item_key as string, playerId: row.player_id as string,
      inventory: row.inventory as number,
      ...(Number.isInteger(row.fitness) && Number.isInteger(row.morale)
        ? { player: { fitness: row.fitness as number, morale: row.morale as number } }
        : {}),
      replayed: row.replayed,
    };
  }
}
