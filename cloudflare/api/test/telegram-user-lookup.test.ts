import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseTelegramUserLookupRepository } from "../src/repositories/telegram-user-lookup.js";

test("Telegram user lookup calls the guarded Supabase RPC", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const user = { id: "user-1", telegramId: "12345", username: null, displayName: "Player", createdAt: "2026-11-18T12:00:00.000Z" };
  const repository = new SupabaseTelegramUserLookupRepository({ rpc: async (name: string, args: Record<string, unknown>) => { call = { name, args }; return user; } } as never);
  assert.deepEqual(await repository.loadActiveUser("12345", new Date("2026-11-18T12:01:00.000Z")), user);
  assert.deepEqual(call, { name: "resolve_telegram_user", args: { p_telegram_id: "12345", p_now: "2026-11-18T12:01:00.000Z" } });
});

test("Telegram user lookup preserves unknown or suspended identities as null", async () => {
  const repository = new SupabaseTelegramUserLookupRepository({ rpc: async () => null } as never);
  assert.equal(await repository.loadActiveUser("12345"), null);
});
