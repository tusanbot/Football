import test from "node:test";
import assert from "node:assert/strict";
import worker, { BotUpdateGuard } from "../src/worker.js";

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

function guardRequest(path: string, updateId: number) {
  return new Request("https://guard" + path, { method: "POST", body: JSON.stringify({ updateId }) });
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

test("update guard claims once and marks completed updates as duplicates", async () => {
  const storage = new MemoryStorage();
  const guard = new BotUpdateGuard({ storage } as never);
  const first = await guard.fetch(guardRequest("/claim", 123));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { result: "claimed" });
  const concurrent = await guard.fetch(guardRequest("/claim", 123));
  assert.equal(concurrent.status, 409);
  await guard.fetch(guardRequest("/complete", 123));
  const duplicate = await guard.fetch(guardRequest("/claim", 123));
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { result: "duplicate" });
});

test("update guard releases failed updates so Telegram retries can process them", async () => {
  const storage = new MemoryStorage();
  const guard = new BotUpdateGuard({ storage } as never);
  await guard.fetch(guardRequest("/claim", 456));
  await guard.fetch(guardRequest("/release", 456));
  const retry = await guard.fetch(guardRequest("/claim", 456));
  assert.deepEqual(await retry.json(), { result: "claimed" });
});
