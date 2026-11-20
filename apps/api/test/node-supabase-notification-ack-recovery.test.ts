import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { NodeSupabaseAdminGroupBroadcastRepository } from "../src/node-supabase-admin-group-broadcast.js";
import { NodeSupabaseMatchNotificationRepository } from "../src/game/node-supabase-match-notifications.js";
import { NodeSupabaseTelegramMessageDeletionRepository } from "../src/node-supabase-telegram-message-deletions.js";

const url = "https://example.supabase.co";
const key = "notification-ack-recovery-service-role-key";

async function assertLostAckRecovery(run: (client: SupabaseHttpClient) => Promise<boolean>, expectedRpc: string) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let durableCompletions = 0;
  globalThis.fetch = (async (input, init) => {
    const requestUrl = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: requestUrl, body });
    assert.equal(requestUrl, url + "/rest/v1/rpc/" + expectedRpc);
    if (calls.length === 1) {
      durableCompletions++;
      throw new TypeError("socket closed after completion commit");
    }
    return new Response("true", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const client = new SupabaseHttpClient({ url, serviceRoleKey: key });
    await assert.rejects(run(client), /Supabase HTTP request failed/);
    assert.equal(calls.length, 1, "mutation transport must not retry completion automatically");
    assert.equal(await run(client), true, "the same successful completion must be replayable");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]!.body, calls[0]!.body, "ack recovery must preserve the original claim token");
    assert.equal(durableCompletions, 1, "ack replay must not repeat the external delivery");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("admin group broadcast completion recovers a committed RPC after its HTTP response is lost", async () => {
  await assertLostAckRecovery(
    (client) => new NodeSupabaseAdminGroupBroadcastRepository(client).complete("delivery-1", "11111111-1111-4111-8111-111111111111"),
    "complete_admin_group_broadcast_delivery_http",
  );
});

test("match result notification acknowledgement recovers a committed RPC after its HTTP response is lost", async () => {
  await assertLostAckRecovery(
    (client) => new NodeSupabaseMatchNotificationRepository(client).complete(
      "RESULT", "notification-1", "22222222-2222-4222-8222-222222222222", true, null, 30,
    ),
    "complete_match_notification_delivery",
  );
});

test("match lifecycle notification acknowledgement recovers a committed RPC after its HTTP response is lost", async () => {
  await assertLostAckRecovery(
    (client) => new NodeSupabaseMatchNotificationRepository(client).complete(
      "LIFECYCLE", "notification-2", "33333333-3333-4333-8333-333333333333", true, null, 15,
    ),
    "complete_match_notification_delivery",
  );
});

test("Telegram message deletion completion recovers a committed RPC after its HTTP response is lost", async () => {
  await assertLostAckRecovery(
    (client) => new NodeSupabaseTelegramMessageDeletionRepository(client).complete(
      "deletion-1", "44444444-4444-4444-8444-444444444444",
    ),
    "complete_telegram_message_deletion_http",
  );
});
