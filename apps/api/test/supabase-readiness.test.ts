import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("API readiness depends on Supabase HTTP and not a PostgreSQL TCP URL", async () => {
  const keys = ["NODE_ENV", "DATABASE_URL", "TELEGRAM_BOT_TOKEN", "BOT_API_SECRET", "CORS_ORIGIN", "GAME_ADMIN_TELEGRAM_IDS"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.NODE_ENV = "test";
  delete process.env.DATABASE_URL;
  process.env.TELEGRAM_BOT_TOKEN = "123456:abcdefghijklmnopqrstuvwxyzABCDE";
  process.env.BOT_API_SECRET = "a".repeat(48);
  process.env.CORS_ORIGIN = "https://example.test";
  process.env.GAME_ADMIN_TELEGRAM_IDS = "123456789";

  const calls: unknown[] = [];
  const supabaseHttpClient = {
    select: async (...args: unknown[]) => { calls.push(args); return []; },
  };
  const app = buildApp({ logger: false, supabaseHttpClient: supabaseHttpClient as never });
  try {
    const response = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ready", service: "football-empire-api" });
    assert.equal(calls.length, 1);
  } finally {
    await app.close();
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
