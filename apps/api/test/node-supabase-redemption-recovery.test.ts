import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseGiftCodeRedemptionRepository } from "../src/node-supabase-gift-code-redemption.js";
import { SupabaseSpecialAcquisitionRepository } from "../src/players/node-supabase-special-acquisition.js";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";

const url = "https://example.supabase.co";
const key = "node-redemption-service-role-test-key";

function installLostResponseFetch(replayPayload: unknown, errorMessage: string) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let durableEffects = 0;
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    if (calls.length === 1) {
      durableEffects++;
      throw new TypeError(errorMessage);
    }
    return new Response(JSON.stringify(replayPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    get durableEffects() { return durableEffects; },
    restore() { globalThis.fetch = originalFetch; },
  };
}

test("gift-code redemption recovers a committed RPC after its HTTP response is lost without crediting rewards twice", async () => {
  const stub = installLostResponseFetch([{
    cash: "500", gold: "25", group_points: "0", replayed: true,
  }], "socket closed after gift-code redemption commit");
  try {
    const repository = new SupabaseGiftCodeRedemptionRepository(new SupabaseHttpClient({ url, serviceRoleKey: key }));
    const command = {
      userId: "gift-user-replay",
      code: "WELCOME",
      idempotencyKey: "gift-lost-response-0001",
      telegramGroupId: null,
    };
    await assert.rejects(repository.redeem(command), /Supabase HTTP request failed/);
    assert.equal(stub.calls.length, 1, "the HTTP client must not automatically retry a mutation");
    const replay = await repository.redeem(command);
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0]!.url, url + "/rest/v1/rpc/redeem_gift_code");
    assert.deepEqual(stub.calls[1]!.body, stub.calls[0]!.body);
    assert.deepEqual(replay, {
      ok: true,
      reward: { cash: "500", gold: "25", groupPoints: "0" },
      replayed: true,
    });
    assert.equal(stub.durableEffects, 1);
  } finally {
    stub.restore();
  }
});

test("special-player acquisition recovers a committed RPC after its HTTP response is lost without charging gold or granting a second player", async () => {
  const stub = installLostResponseFetch([{
    acquisition_id: "acquisition-replay-1",
    player_id: "player-replay-1",
    method: "epic_pack",
    special_player: { id: "special-replay-1", fullName: "Ari Legend", rarity: "EPIC", overall: 88 },
    gold_balance: "750",
    replayed: true,
  }], "socket closed after special-player acquisition commit");
  try {
    const repository = new SupabaseSpecialAcquisitionRepository(new SupabaseHttpClient({ url, serviceRoleKey: key }));
    const command = {
      userId: "special-user-replay",
      method: "epic_pack" as const,
      idempotencyKey: "special-lost-response-0001",
    };
    await assert.rejects(repository.acquire(command), /Supabase HTTP request failed/);
    assert.equal(stub.calls.length, 1);
    const replay = await repository.acquire(command);
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[0]!.url, url + "/rest/v1/rpc/acquire_special_player");
    assert.deepEqual(stub.calls[1]!.body, stub.calls[0]!.body);
    assert.deepEqual(replay, {
      acquisitionId: "acquisition-replay-1",
      method: "epic_pack",
      playerId: "player-replay-1",
      specialPlayer: { id: "special-replay-1", fullName: "Ari Legend", rarity: "EPIC", overall: 88 },
      goldBalance: "750",
      replayed: true,
    });
    assert.equal(stub.durableEffects, 1);
  } finally {
    stub.restore();
  }
});
