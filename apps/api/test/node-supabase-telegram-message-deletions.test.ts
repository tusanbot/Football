import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseTelegramMessageDeletionRepository } from "../src/node-supabase-telegram-message-deletions.js";

test("deletion repository calls the atomic scheduling RPC and maps bigint chat ids", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new NodeSupabaseTelegramMessageDeletionRepository({
    rpc: async (name: string, args: Record<string, unknown>) => {
      call = { name, args };
      return [{ id: "job-1", status: "PENDING", delete_at: "2026-11-20T12:00:00.000Z" }];
    },
  } as never);
  const result = await repository.schedule({ telegramChatId: "-100123456789", messageId: 42, deleteAt: "2026-11-20T12:00:00.000Z" });
  assert.equal(call?.name, "schedule_telegram_message_deletion_http");
  assert.deepEqual(call?.args, { p_telegram_chat_id: "-100123456789", p_message_id: 42, p_delete_at: "2026-11-20T12:00:00.000Z" });
  assert.equal(result.id, "job-1");
});
test("deletion repository validates claimed rows and preserves chat id as a string", async () => {
  const repository = new NodeSupabaseTelegramMessageDeletionRepository({
    rpc: async () => [{ id: "job-1", telegram_chat_id: "-100123456789", message_id: 42, claim_token: "token" }],
  } as never);
  assert.deepEqual(await repository.claim(25), [{ id: "job-1", telegramChatId: "-100123456789", messageId: 42, claimToken: "token" }]);
  const invalid = new NodeSupabaseTelegramMessageDeletionRepository({ rpc: async () => [{ id: "job-1", telegram_chat_id: 1, message_id: "42" }] } as never);
  await assert.rejects(() => invalid.claim(25), /INVALID_CLAIM_ROW/);
});
test("deletion repository validates completion and failure responses", async () => {
  const repository = new NodeSupabaseTelegramMessageDeletionRepository({
    rpc: async (name: string) => name === "complete_telegram_message_deletion_http" ? true : [{ rescheduled: true, failed: false, attempts: 2 }],
  } as never);
  assert.equal(await repository.complete("job-1", "claim"), true);
  assert.deepEqual(await repository.fail("job-1", "claim", "temporary error"), { rescheduled: true, failed: false, attempts: 2 });
  const malformed = new NodeSupabaseTelegramMessageDeletionRepository({ rpc: async () => "true" } as never);
  await assert.rejects(() => malformed.complete("job-1", "claim"), /INVALID_COMPLETION_RESPONSE/);
});
