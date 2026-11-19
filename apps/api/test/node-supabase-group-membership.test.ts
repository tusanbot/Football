import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseGroupMembershipRepository } from "../src/groups/node-supabase-group-membership.js";
import { GroupMembershipPortError } from "../src/groups/group-membership-context.js";

function makeRepository(payload: unknown, status = 200) {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const repository = new NodeSupabaseGroupMembershipRepository("https://example.supabase.co", "service-role-key-for-node-group-tests");
  return { repository, calls, restore: () => { globalThis.fetch = original; } };
}

test("Node group repository sends authenticated HTTPS RPC requests", async () => {
  const { repository, calls, restore } = makeRepository({ userExists: true, userSuspended: false, groupExists: true, groupSuspended: false });
  try {
    assert.deepEqual(await repository.getActorStatus("123", "-100123"), {
      userExists: true, userSuspended: false, groupExists: true, groupSuspended: false,
    });
    assert.equal(calls[0]!.url, "https://example.supabase.co/rest/v1/rpc/get_group_actor_status_http");
    assert.equal(calls[0]!.headers.get("authorization"), "Bearer service-role-key-for-node-group-tests");
    assert.equal(calls[0]!.headers.get("apikey"), "service-role-key-for-node-group-tests");
    assert.deepEqual(calls[0]!.body, { p_telegram_user_id: "123", p_telegram_group_id: "-100123" });
  } finally { restore(); }
});

test("Node group repository maps SQL business exceptions to typed errors", async () => {
  const { repository, restore } = makeRepository({ message: "GROUP_MANAGER_REQUIRED", code: "P0001" }, 400);
  try {
    await assert.rejects(repository.createLeague({
      telegramUserId: "123", telegramGroupId: "-100123", name: "Test League", maxTeams: 8, idempotencyKey: "league-idempotency-123",
    }), (error: unknown) => error instanceof GroupMembershipPortError && error.code === "GROUP_MANAGER_REQUIRED");
  } finally { restore(); }
});

test("Node group repository rejects non-Supabase origins and incomplete credentials", () => {
  assert.throws(() => new NodeSupabaseGroupMembershipRepository("https://attacker.example", "service-role-key-for-node-group-tests"));
  assert.throws(() => new NodeSupabaseGroupMembershipRepository("https://example.supabase.co", "short"));
});
