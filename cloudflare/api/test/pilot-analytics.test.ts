import assert from "node:assert/strict";
import test from "node:test";
import { SupabasePilotAnalyticsRepository } from "../src/repositories/pilot-analytics.js";

test("pilot analytics writes through Supabase PostgREST without a Prisma client", async () => {
  let call: { table: string; rows: unknown } | undefined;
  const client = {
    insert: async (table: string, rows: unknown) => { call = { table, rows }; return []; },
  } as never;
  const repository = new SupabasePilotAnalyticsRepository(client);
  await repository.record({
    eventName: "bot_command",
    userKey: "0123456789abcdef0123456789abcdef",
    actionKey: "start",
    chatType: "private",
    source: "bot",
  });
  assert.equal(call?.table, "PilotAnalyticsEvent");
  assert.deepEqual(call?.rows, {
    eventName: "bot_command",
    userKey: "0123456789abcdef0123456789abcdef",
    actionKey: "start",
    chatType: "private",
    source: "bot",
  });
});

test("pilot analytics propagates persistence failures", async () => {
  const client = { insert: async () => { throw new Error("database unavailable"); } } as never;
  const repository = new SupabasePilotAnalyticsRepository(client);
  await assert.rejects(() => repository.record({
    eventName: "bot_start", userKey: "0123456789abcdef0123456789abcdef",
    actionKey: "", chatType: "unknown", source: "bot",
  }), /database unavailable/);
});
