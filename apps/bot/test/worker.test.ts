import test from "node:test";
import assert from "node:assert/strict";
import worker, { BotUpdateGuard, verifyTelegramInitData } from "../src/worker.js";

class MemoryStorage {
  values = new Map<string, unknown>();
  alarmAt = 0;
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<boolean> { return this.values.delete(key); }
  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    return new Map([...this.values.entries()].filter(([key]) => !options?.prefix || key.startsWith(options.prefix)) as [string, T][]);
  }
  async setAlarm(time: number): Promise<void> { this.alarmAt = time; }
  async transaction<T>(callback: (transaction: MemoryStorage) => Promise<T>): Promise<T> { return callback(this); }
}

function guardRequest(path: string, updateId: number, claimToken?: string) {
  return new Request("https://guard" + path, {
    method: "POST", body: JSON.stringify({ updateId, ...(claimToken ? { claimToken } : {}) }),
  });
}

test("health route is available without Telegram secrets", async () => {
  const response = await worker.fetch(new Request("https://bot/health"), {} as never);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("webhook rejects non-POST requests and unknown paths", async () => {
  const env = {} as never;
  assert.equal((await worker.fetch(new Request("https://bot/telegram/webhook"), env)).status, 405);
  assert.equal((await worker.fetch(new Request("https://bot/unknown"), env)).status, 404);
});

test("webhook rejects an invalid Telegram secret before parsing or dispatch", async () => {
  const response = await worker.fetch(new Request("https://bot/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "wrong" },
    body: JSON.stringify({ update_id: 1 }),
  }), { TELEGRAM_WEBHOOK_SECRET: "correct-secret" } as never);
  assert.equal(response.status, 401);
});

test("update guard claims once and makes completion idempotent for the owning claim token", async () => {
  const storage = new MemoryStorage();
  const guard = new BotUpdateGuard({ storage } as never);
  const first = await guard.fetch(guardRequest("/claim", 123));
  assert.equal(first.status, 200);
  const claim = await first.json() as { result: string; claimToken: string };
  assert.equal(claim.result, "claimed");
  assert.match(claim.claimToken, /^[0-9a-f-]{36}$/i);
  const concurrent = await guard.fetch(guardRequest("/claim", 123));
  assert.equal(concurrent.status, 409);
  const completed = await guard.fetch(guardRequest("/complete", 123, claim.claimToken));
  assert.equal(completed.status, 200);
  const replay = await guard.fetch(guardRequest("/complete", 123, claim.claimToken));
  assert.equal(replay.status, 200, "lost completion responses must be safely replayable");
  const duplicate = await guard.fetch(guardRequest("/claim", 123));
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { result: "duplicate" });
});

test("update guard fences an expired worker from completing or releasing a newer claim", async () => {
  const storage = new MemoryStorage();
  const guard = new BotUpdateGuard({ storage } as never);
  const firstResponse = await guard.fetch(guardRequest("/claim", 456));
  const first = await firstResponse.json() as { claimToken: string };
  await storage.put("update:456", {
    state: "processing", updatedAt: Date.now() - 60_001, claimToken: first.claimToken,
  });
  const secondResponse = await guard.fetch(guardRequest("/claim", 456));
  const second = await secondResponse.json() as { result: string; claimToken: string };
  assert.equal(second.result, "claimed");
  assert.notEqual(second.claimToken, first.claimToken);
  assert.equal((await guard.fetch(guardRequest("/complete", 456, first.claimToken))).status, 409);
  assert.equal((await guard.fetch(guardRequest("/release", 456, first.claimToken))).status, 409);
  assert.equal((await guard.fetch(guardRequest("/complete", 456, second.claimToken))).status, 200);
});

test("update guard renews an active claim and rejects stale heartbeat tokens", async () => {
  const storage = new MemoryStorage();
  const guard = new BotUpdateGuard({ storage } as never);
  const firstResponse = await guard.fetch(guardRequest("/claim", 654));
  const first = await firstResponse.json() as { claimToken: string };
  const initial = await storage.get<{ updatedAt: number }>("update:654");
  await new Promise(resolve => setTimeout(resolve, 2));
  const renewed = await guard.fetch(guardRequest("/heartbeat", 654, first.claimToken));
  assert.equal(renewed.status, 200);
  const afterRenewal = await storage.get<{ updatedAt: number }>("update:654");
  assert.ok(afterRenewal!.updatedAt > initial!.updatedAt);

  await storage.put("update:654", {
    state: "processing", updatedAt: Date.now() - 60_001, claimToken: first.claimToken,
  });
  const takeoverResponse = await guard.fetch(guardRequest("/claim", 654));
  const takeover = await takeoverResponse.json() as { claimToken: string };
  assert.notEqual(takeover.claimToken, first.claimToken);
  assert.equal((await guard.fetch(guardRequest("/heartbeat", 654, first.claimToken))).status, 409);
  assert.equal((await guard.fetch(guardRequest("/heartbeat", 654, takeover.claimToken))).status, 200);
});

test("update guard releases failed updates only for the owning claim token", async () => {
  const storage = new MemoryStorage();
  const guard = new BotUpdateGuard({ storage } as never);
  const firstResponse = await guard.fetch(guardRequest("/claim", 789));
  const first = await firstResponse.json() as { claimToken: string };
  assert.equal((await guard.fetch(guardRequest("/release", 789, first.claimToken))).status, 200);
  const retry = await guard.fetch(guardRequest("/claim", 789));
  assert.equal((await retry.json() as { result: string }).result, "claimed");
});

async function hmac(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function signedInitData(botToken: string, userId: number, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("user", JSON.stringify({ id: userId, first_name: "Test" }));
  const checkString = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => k + "=" + v).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const hash = await hmac(secret, checkString);
  params.set("hash", Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join(""));
  return params.toString();
}

test("Telegram Mini App initData is cryptographically verified and time-bounded", async () => {
  const token = "123456:staging-test-token";
  const valid = await signedInitData(token, 987654321);
  assert.equal(await verifyTelegramInitData(valid, token), 987654321);
  assert.equal(await verifyTelegramInitData(valid.replace("987654321", "987654322"), token), null);
  const expired = await signedInitData(token, 987654321, Math.floor(Date.now() / 1000) - 86_500);
  assert.equal(await verifyTelegramInitData(expired, token), null);
});

test("Mini App telemetry forwards a pseudonymous event to the private API endpoint", async () => {
  const token = "123456:staging-test-token";
  const initData = await signedInitData(token, 987654321);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const pendingAnalytics: Promise<unknown>[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  try {
    const env = {
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_WEB_APP_URL: "https://game.example",
      FOOTBALL_API_URL: "https://api.example",
      BOT_API_SECRET: "b".repeat(48),
      ANALYTICS_HASH_SECRET: "a".repeat(48),
    } as never;
    const response = await worker.fetch(new Request("https://bot/miniapp/launch", {
      method: "POST",
      headers: { origin: "https://game.example", "content-type": "application/json" },
      body: JSON.stringify({ initData }),
    }), env, { waitUntil(promise) { pendingAnalytics.push(promise); } });
    assert.equal(response.status, 204);
    await Promise.all(pendingAnalytics);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://api.example/internal/pilot/events");
    const body = JSON.parse(String(requests[0]?.init?.body)) as { eventName: string; userKey: string; source: string };
    assert.equal(body.eventName, "miniapp_session");
    assert.equal(body.source, "miniapp");
    assert.match(body.userKey, /^[a-f0-9]{32}$/);
    assert.notEqual(body.userKey, "987654321");
    assert.equal(new Headers(requests[0]?.init?.headers).get("x-football-bot-secret"), "b".repeat(48));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
