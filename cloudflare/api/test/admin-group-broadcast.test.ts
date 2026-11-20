import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminGroupBroadcastRepository } from "../src/repositories/admin-group-broadcast.js";
function repository(response: unknown) {
 const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
 const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return response; } } as never;
 return { repo: new SupabaseAdminGroupBroadcastRepository(client), calls };
}
test("Worker group broadcast repository claims, completes and fails using existing RPCs", async () => {
 const claim = repository([{ id: "delivery-1", telegram_group_id: "-1001", message: "hello", claim_token: "123e4567-e89b-12d3-a456-426614174000", attempt: 1 }]);
 assert.deepEqual(await claim.repo.claim(10), [{ id: "delivery-1", telegramGroupId: "-1001", message: "hello", claimToken: "123e4567-e89b-12d3-a456-426614174000", attempt: 1 }]);
 assert.equal(claim.calls[0]?.name, "claim_due_admin_group_broadcasts_http");
 const complete = repository(true);
 assert.equal(await complete.repo.complete("delivery-1", "123e4567-e89b-12d3-a456-426614174000"), true);
 assert.equal(complete.calls[0]?.name, "complete_admin_group_broadcast_delivery_http");
 const fail = repository([{ rescheduled: true, attempts: 2 }]);
 assert.deepEqual(await fail.repo.fail("delivery-1", "123e4567-e89b-12d3-a456-426614174000", "network error"), { rescheduled: true, attempts: 2 });
 assert.equal(fail.calls[0]?.name, "fail_admin_group_broadcast_delivery_http");
});
test("Worker group broadcast repository validates claim payloads", async () => {
 const { repo } = repository([{ id: "delivery-1" }]);
 await assert.rejects(repo.claim(10), /INVALID_CLAIM_ROW/);
});
