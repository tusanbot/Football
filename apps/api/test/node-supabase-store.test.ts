import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseStoreItemUseRepository, NodeSupabaseStorePurchaseRepository } from "../src/store/node-supabase-store.js";

function stubFetch(payload: unknown, status = 200) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("Node store purchase uses server-authenticated HTTPS RPC and preserves bigint balances", async () => {
  const stub = stubFetch([{ item_key: "recovery_kit", purchased_quantity: 2, balance: "9007199254740993123", inventory: 5, replayed: false }]);
  try {
    const repo = new NodeSupabaseStorePurchaseRepository("https://example.supabase.co", "node-store-service-role-test-key");
    const result = await repo.purchase({
      userId: "user-1", itemKey: "recovery_kit", asset: "CASH", unitPrice: "1200",
      quantity: 2, idempotencyKey: "store-test-0001",
    });
    assert.equal(stub.calls[0]!.url, "https://example.supabase.co/rest/v1/rpc/purchase_store_item");
    assert.equal(stub.calls[0]!.headers.get("authorization"), "Bearer node-store-service-role-test-key");
    assert.equal(stub.calls[0]!.headers.get("apikey"), "node-store-service-role-test-key");
    assert.deepEqual(stub.calls[0]!.body, {
      p_user_id: "user-1", p_item_key: "recovery_kit", p_asset: "CASH",
      p_unit_price: "1200", p_quantity: 2, p_idempotency_key: "store-test-0001",
    });
    assert.equal(result.balance, "9007199254740993123");
    assert.equal(result.inventory, 5);
    assert.equal(result.replayed, false);
  } finally { stub.restore(); }
});

test("Node store purchase maps SQL business errors and rejects malformed results", async () => {
  const failed = stubFetch({ message: "INSUFFICIENT_FUNDS", code: "P0001" }, 400);
  try {
    const repo = new NodeSupabaseStorePurchaseRepository("https://example.supabase.co", "node-store-service-role-test-key");
    await assert.rejects(repo.purchase({
      userId: "user-1", itemKey: "recovery_kit", asset: "CASH", unitPrice: "1200",
      quantity: 1, idempotencyKey: "store-test-0002",
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INSUFFICIENT_FUNDS");
  } finally { failed.restore(); }
  const malformed = stubFetch({ balance: 1 });
  try {
    const repo = new NodeSupabaseStorePurchaseRepository("https://example.supabase.co", "node-store-service-role-test-key");
    await assert.rejects(repo.purchase({
      userId: "user-1", itemKey: "recovery_kit", asset: "CASH", unitPrice: "1200",
      quantity: 1, idempotencyKey: "store-test-0003",
    }), /SUPABASE_STORE_PURCHASE_INVALID_RESPONSE/);
  } finally { malformed.restore(); }
});

test("Node store item use sends atomic RPC arguments and returns updated player stats", async () => {
  const stub = stubFetch([{ item_key: "recovery_kit", player_id: "player-1", inventory: 2, fitness: 88, morale: 72, replayed: false }]);
  try {
    const repo = new NodeSupabaseStoreItemUseRepository("https://example.supabase.co", "node-store-service-role-test-key");
    const result = await repo.use({
      userId: "user-1", itemKey: "recovery_kit", playerId: "player-1",
      fitnessDelta: 35, moraleDelta: 0, idempotencyKey: "store-use-0001",
    });
    assert.equal(stub.calls[0]!.url, "https://example.supabase.co/rest/v1/rpc/use_store_item");
    assert.equal(stub.calls[0]!.body.p_fitness_delta, 35);
    assert.deepEqual(result.player, { fitness: 88, morale: 72 });
    assert.equal(result.inventory, 2);
    assert.equal(result.replayed, false);
  } finally { stub.restore(); }
});

test("Node store item use accepts idempotent replay without player stats", async () => {
  const stub = stubFetch([{ item_key: "recovery_kit", player_id: "player-1", inventory: 1, fitness: null, morale: null, replayed: true }]);
  try {
    const repo = new NodeSupabaseStoreItemUseRepository("https://example.supabase.co", "node-store-service-role-test-key");
    const result = await repo.use({
      userId: "user-1", itemKey: "recovery_kit", playerId: "player-1",
      fitnessDelta: 35, moraleDelta: 0, idempotencyKey: "store-use-0002",
    });
    assert.equal(result.replayed, true);
    assert.equal(result.player, undefined);
  } finally { stub.restore(); }
});

test("Node store adapters reject unsafe origins and weak service-role credentials", () => {
  assert.throws(() => new NodeSupabaseStorePurchaseRepository("http://example.supabase.co", "node-store-service-role-test-key"));
  assert.throws(() => new NodeSupabaseStoreItemUseRepository("https://attacker.example", "node-store-service-role-test-key"));
  assert.throws(() => new NodeSupabaseStorePurchaseRepository("https://example.supabase.co", "short"));
});

test("store purchase recovers a committed RPC after the HTTP response is lost without duplicating debit or inventory", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let durablePurchases = 0;
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    if (calls.length === 1) {
      durablePurchases++;
      throw new TypeError("socket closed after store purchase commit");
    }
    return new Response(JSON.stringify([{
      item_key: "recovery_kit", purchased_quantity: 2, balance: "7600", inventory: 4, replayed: true,
    }]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const repo = new NodeSupabaseStorePurchaseRepository("https://example.supabase.co", "node-store-service-role-test-key");
    const command = {
      userId: "user-store-replay", itemKey: "recovery_kit", asset: "CASH" as const,
      unitPrice: "1200", quantity: 2, idempotencyKey: "store-lost-response-001",
    };
    await assert.rejects(repo.purchase(command), /Supabase store RPC request failed/);
    assert.equal(calls.length, 1, "the transport must not automatically retry a store mutation");
    const replay = await repo.purchase(command);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]!.body, calls[0]!.body);
    assert.equal(replay.replayed, true);
    assert.equal(replay.balance, "7600");
    assert.equal(replay.inventory, 4);
    assert.equal(durablePurchases, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("store item use recovers a committed RPC after its HTTP response is lost without consuming inventory or applying player effects twice", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let durableUses = 0;
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    if (calls.length === 1) {
      durableUses++;
      throw new TypeError("socket closed after store item use commit");
    }
    return new Response(JSON.stringify([{
      item_key: "recovery_kit", player_id: "player-use-replay", inventory: 1,
      fitness: null, morale: null, replayed: true,
    }]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const repo = new NodeSupabaseStoreItemUseRepository("https://example.supabase.co", "node-store-service-role-test-key");
    const command = {
      userId: "user-store-use-replay", itemKey: "recovery_kit", playerId: "player-use-replay",
      fitnessDelta: 35, moraleDelta: 10, idempotencyKey: "store-use-lost-response-001",
    };
    await assert.rejects(repo.use(command), /Supabase store RPC request failed/);
    assert.equal(calls.length, 1, "the transport must not automatically retry item consumption");
    const replay = await repo.use(command);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.url, "https://example.supabase.co/rest/v1/rpc/use_store_item");
    assert.deepEqual(calls[1]!.body, calls[0]!.body);
    assert.deepEqual(replay, {
      itemKey: "recovery_kit", playerId: "player-use-replay", inventory: 1, replayed: true,
    });
    assert.equal(durableUses, 1);
  } finally { globalThis.fetch = originalFetch; }
});

