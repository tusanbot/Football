import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/supabase-http.js";
import { SupabaseGroupMembershipRepository } from "../src/repositories/group-membership.js";
import { GroupMembershipPortError } from "../../../apps/api/src/groups/group-membership-context.js";

function repository(response: unknown) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co", serviceRoleKey: "service-role-key-for-group-membership",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  return { instance: new SupabaseGroupMembershipRepository(client), calls };
}
test("group registration uses the Supabase HTTP RPC and passes role and count", async () => {
  const { instance, calls } = repository({ group: { id: "g1", telegramId: "-1001234567890", title: "Test", memberCount: 20, isActive: true, points: "0" }, role: "OWNER", registeredManagers: 1, minimumMembers: 10 });
  const result = await instance.registerGroup({ telegramUserId: "123", telegramGroupId: "-1001234567890", title: "Test", role: "OWNER", memberCount: 20 }, new Date("2026-11-19T12:00:00.000Z"));
  assert.equal((result as { role: string }).role, "OWNER");
  assert.match(calls[0]!.url, /rpc\/register_telegram_group_http$/);
  assert.deepEqual(calls[0]!.body, { p_telegram_user_id: "123", p_telegram_group_id: "-1001234567890", p_title: "Test", p_role: "OWNER", p_member_count: 20, p_now: "2026-11-19T12:00:00.000Z" });
});
test("group join maps domain failures without hiding them", async () => {
  const { instance } = repository({ error: "GROUP_MINIMUM_MEMBERS_REQUIRED", minimumMembers: 10 });
  await assert.rejects(instance.joinGroup({ telegramUserId: "123", telegramGroupId: "-1001234567890", memberCount: 4 }), (error: unknown) => error instanceof GroupMembershipPortError && error.code === "GROUP_MINIMUM_MEMBERS_REQUIRED");
});
test("group actor status validates all authorization flags", async () => {
  const { instance } = repository({ userExists: true, userSuspended: false, groupExists: true, groupSuspended: true });
  assert.deepEqual(await instance.getActorStatus("123", "-1001234567890"), { userExists: true, userSuspended: false, groupExists: true, groupSuspended: true });
});

test("group league lifecycle uses group-scoped Supabase RPCs", async () => {
  const { instance, calls } = repository({ ok: true });
  const now = new Date("2026-11-19T12:30:00.000Z");
  await instance.createLeague({ telegramUserId: "123", telegramGroupId: "-1001234567890", name: "Group League", maxTeams: 8, idempotencyKey: "group-league:1234567890", now });
  await instance.joinLeague({ telegramUserId: "123", telegramGroupId: "-1001234567890", competitionId: "competition_1", now });
  await instance.startLeague({ telegramUserId: "123", telegramGroupId: "-1001234567890", competitionId: "competition_1", now });
  await instance.getLeagueTable({ telegramUserId: "123", telegramGroupId: "-1001234567890", competitionId: "competition_1" });
  await instance.listLeagues({ telegramUserId: "123", telegramGroupId: "-1001234567890" });
  assert.deepEqual(calls.map(call => new URL(call.url).pathname.split("/").at(-1)), [
    "create_group_league_http", "join_group_league_http", "start_group_league_http",
    "get_group_league_table_http", "list_group_leagues_http",
  ]);
  assert.deepEqual(calls[0]!.body, {
    p_telegram_user_id: "123", p_telegram_group_id: "-1001234567890", p_name: "Group League",
    p_max_teams: 8, p_idempotency_key: "group-league:1234567890", p_now: now.toISOString(),
  });
  assert.deepEqual(calls[1]!.body, {
    p_telegram_user_id: "123", p_telegram_group_id: "-1001234567890",
    p_competition_id: "competition_1", p_now: now.toISOString(),
  });
  assert.deepEqual(calls[3]!.body, {
    p_telegram_user_id: "123", p_telegram_group_id: "-1001234567890", p_competition_id: "competition_1",
  });
});
test("group league RPC business errors remain typed", async () => {
  const { instance } = repository({ error: "GROUP_MANAGER_REQUIRED" });
  await assert.rejects(
    instance.createLeague({ telegramUserId: "123", telegramGroupId: "-1001234567890", name: "Group League", maxTeams: 8, idempotencyKey: "group-league:1234567890" }),
    (error: unknown) => error instanceof GroupMembershipPortError && error.code === "GROUP_MANAGER_REQUIRED",
  );
});
