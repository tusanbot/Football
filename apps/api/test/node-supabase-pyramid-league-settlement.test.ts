import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { SupabasePyramidLeagueSettlementRepository } from "../src/game/node-supabase-pyramid-league-settlement.js";

test("pyramid league application calls the atomic Supabase RPC and validates its response", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-key-that-is-long-enough",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        applied: true, replayed: false, status: "ASSIGNED", leagueId: "league-1",
        competitionId: "competition-1", tier: 1, tierName: "لیگ پایه", season: 2027,
        groupNumber: 1, teams: 8, fixturesCreated: 28, waitingTeams: 0,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const repository = new SupabasePyramidLeagueSettlementRepository(client);
  const result = await repository.apply("user-1", 1, "2026-11-20T12:34:56.789Z");
  assert.equal(new URL(requestUrl).pathname, "/rest/v1/rpc/apply_pyramid_league_http");
  assert.deepEqual(requestBody, {
    p_user_id: "user-1", p_tier: 1, p_now: "2026-11-20T12:34:56.789Z",
  });
  assert.equal(result.status, "ASSIGNED");
  assert.equal(result.fixturesCreated, 28);
});

test("pyramid league application rejects malformed RPC responses", async () => {
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-key-that-is-long-enough",
    fetchImpl: async () => new Response(JSON.stringify({ applied: true }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  });
  const repository = new SupabasePyramidLeagueSettlementRepository(client);
  await assert.rejects(
    () => repository.apply("user-1", 1, "2026-11-20T12:34:56.789Z"),
    /SUPABASE_PYRAMID_APPLICATION_INVALID_RESPONSE/,
  );
});

test("pyramid league application rejects incomplete assigned league payloads", async () => {
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-key-that-is-long-enough",
    fetchImpl: async () => new Response(JSON.stringify({
      applied: true, replayed: false, status: "ASSIGNED", waitingTeams: 0,
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const repository = new SupabasePyramidLeagueSettlementRepository(client);
  await assert.rejects(
    () => repository.apply("user-1", 1, "2026-11-20T12:34:56.789Z"),
    /SUPABASE_PYRAMID_APPLICATION_INVALID_ASSIGNMENT/,
  );
});

test("pyramid league overview and history invoke their dedicated read RPCs", async () => {
 const calls: string[] = [];
 const payloads = [
  { season: 2027, tiers: [], history: [], promotionOffers: [] },
  { club: { id: "club-1", name: "Club" }, stats: {}, tiers: [], movements: [], leagues: [] },
 ];
 const client = new SupabaseHttpClient({ url: "https://example.supabase.co", serviceRoleKey: "service-role-key-that-is-long-enough", fetchImpl: async (input) => {
  calls.push(new URL(String(input)).pathname);
  return new Response(JSON.stringify(payloads.shift()), { status: 200, headers: { "content-type": "application/json" } });
 }});
 const repository = new SupabasePyramidLeagueSettlementRepository(client);
 assert.equal((await repository.listLeagues("user-1")).season, 2027);
 assert.equal((await repository.getClubHistory("user-1")).club !== undefined, true);
 assert.deepEqual(calls, ["/rest/v1/rpc/get_pyramid_league_overview_http", "/rest/v1/rpc/get_pyramid_league_history_http"]);
});
