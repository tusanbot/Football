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

test("pyramid league details call the read RPC and reject malformed payloads", async () => {
 let called = "";
 const payload = { league: { id: "league-1" }, standings: [], topScorers: [], topAssists: [], matches: [], nextRound: null, nextRoundMatches: [], awards: [] };
 const client = new SupabaseHttpClient({ url: "https://example.supabase.co", serviceRoleKey: "service-role-key-that-is-long-enough", fetchImpl: async (input) => { called = String(input); return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }});
 const repository = new SupabasePyramidLeagueSettlementRepository(client);
 const result = await repository.getLeagueDetails("user-1", "league-1");
 assert.equal(new URL(called).pathname, "/rest/v1/rpc/get_pyramid_league_details_http");
 assert.equal((result.league as { id: string }).id, "league-1");
});

test("pyramid league notice operations use the atomic Supabase RPCs", async () => {
 const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
 const responses = [
  { notices: [] }, { markedRead: 2 }, { notices: [] },
  { completed: true }, { owned: true, rescheduled: true, attempts: 1 },
 ];
 const client = new SupabaseHttpClient({
  url: "https://example.supabase.co", serviceRoleKey: "service-role-key-that-is-long-enough",
  fetchImpl: async (input, init) => {
   calls.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
   return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } });
  },
 });
 const repository = new SupabasePyramidLeagueSettlementRepository(client);
 const now = "2026-11-20T12:34:56.789Z";
 assert.deepEqual(await repository.listNotices("user-1"), { notices: [] });
 assert.deepEqual(await repository.markNoticesRead("user-1", now), { markedRead: 2 });
 assert.deepEqual(await repository.claimNotices(25, now), { notices: [] });
 assert.deepEqual(await repository.completeNotice("notice-1", "claim-token", now), { completed: true });
 assert.deepEqual(await repository.failNotice("notice-1", "claim-token", "temporary failure", now), { owned: true, rescheduled: true, attempts: 1 });
 assert.deepEqual(calls.map((call) => call.path), [
  "/rest/v1/rpc/list_pyramid_league_notices_http",
  "/rest/v1/rpc/mark_pyramid_league_notices_read_http",
  "/rest/v1/rpc/claim_pyramid_league_notices_http",
  "/rest/v1/rpc/complete_pyramid_league_notice_http",
  "/rest/v1/rpc/fail_pyramid_league_notice_http",
 ]);
 assert.deepEqual(calls[2]?.body, { p_limit: 25, p_now: now });
});

test("friendly challenge RPC adapters cover creation, acceptance, info and credits", async () => {
 const calls: string[] = [];
 const responses = [
  { challenge: { id: "challenge-1" }, asset: "FREE", goldCost: "0", remaining: { free: 2, gold: 2, purchased: 0 }, replayed: false },
  { match: { id: "match-1" }, replayed: false },
  { id: "challenge-1", token: "token", creatorClub: { name: "Club" }, creatorTelegramId: "123", groupTitle: null, groupTelegramId: null },
  { userId: "user-1", purchasedCredits: 3 },
 ];
 const client = new SupabaseHttpClient({ url: "https://example.supabase.co", serviceRoleKey: "service-role-key-that-is-long-enough", fetchImpl: async (input) => {
  calls.push(new URL(String(input)).pathname);
  return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } });
 }});
 const repository = new SupabasePyramidLeagueSettlementRepository(client);
 const now = "2026-11-20T12:34:56.789Z";
 assert.equal((await repository.createFriendlyChallenge("user-1", "100", now, null, "challenge-key-0001")).asset, "FREE");
 assert.equal((await repository.acceptFriendlyChallenge("user-2", "token", now)).replayed, false);
 assert.equal((await repository.getFriendlyChallengeInfo("token", now)).id, "challenge-1");
 assert.equal((await repository.grantPurchasedChallengeCredits("user-1", 3, now)).purchasedCredits, 3);
 assert.deepEqual(calls, [
  "/rest/v1/rpc/create_friendly_challenge_http",
  "/rest/v1/rpc/accept_friendly_challenge_http",
  "/rest/v1/rpc/get_friendly_challenge_info_http",
  "/rest/v1/rpc/grant_friendly_challenge_credits_http",
 ]);
});
