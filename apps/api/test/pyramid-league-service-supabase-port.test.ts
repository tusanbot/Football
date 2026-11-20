import assert from "node:assert/strict";
import test from "node:test";
import { applyForPyramidLeague, processDuePromotionOffers, processPyramidLeagueCompletion, respondToPromotion } from "../src/game/league-pyramid-service.js";
import { withPyramidLeagueSettlementPort, type PyramidLeagueSettlementPort } from "../src/game/pyramid-league-settlement-context.js";

function fakePort(calls: Array<{ method: string; args: unknown[] }>): PyramidLeagueSettlementPort {
  return {
    async apply(...args) {
      calls.push({ method: "apply", args });
      return { applied: true, replayed: false, status: "QUEUED", waitingTeams: 1, requiredTeams: 8 };
    },
    async finalize(...args) {
      calls.push({ method: "finalize", args });
      return { processed: true, leagueId: "league-1" };
    },
    async respond(...args) {
      calls.push({ method: "respond", args });
      return { accepted: true, replayed: false };
    },
    async processDue(...args) {
      calls.push({ method: "processDue", args });
      return { completedLeagues: 1, processed: 2, accepted: 2 };
    },
    async listLeagues(...args) { calls.push({ method: "listLeagues", args }); return { season: 2027, tiers: [], history: [], promotionOffers: [] }; },
    async getClubHistory(...args) { calls.push({ method: "getClubHistory", args }); return { club: {}, stats: {}, tiers: [], movements: [], leagues: [] }; },
    async getLeagueDetails(...args) { calls.push({ method: "getLeagueDetails", args }); return { league: {}, standings: [], matches: [], topScorers: [], topAssists: [], awards: [], nextRoundMatches: [] }; },
    async listNotices(...args) { calls.push({ method: "listNotices", args }); return { notices: [] }; },
    async markNoticesRead(...args) { calls.push({ method: "markNoticesRead", args }); return { markedRead: 0 }; },
    async claimNotices(...args) { calls.push({ method: "claimNotices", args }); return { notices: [] }; },
    async completeNotice(...args) { calls.push({ method: "completeNotice", args }); return { completed: true }; },
    async failNotice(...args) { calls.push({ method: "failNotice", args }); return { owned: true, rescheduled: true, attempts: 1 }; },
  };
}

test("pyramid league application uses the request-scoped Supabase repository", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const now = new Date("2026-11-20T12:34:56.789Z");
  const result = await withPyramidLeagueSettlementPort(fakePort(calls), () => applyForPyramidLeague("user-1", 1, now));
  assert.equal(result.status, "QUEUED");
  assert.deepEqual(calls, [{ method: "apply", args: ["user-1", 1, now.toISOString()] }]);
});

test("pyramid league finalization, promotion response and due work use the Supabase repository", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const now = new Date("2026-11-20T12:34:56.789Z");
  await withPyramidLeagueSettlementPort(fakePort(calls), async () => {
    assert.equal((await processPyramidLeagueCompletion("competition-1", now)).processed, true);
    assert.equal((await respondToPromotion("user-1", "offer-1", true, now)).accepted, true);
    assert.deepEqual(await processDuePromotionOffers(now, 10), { completedLeagues: 1, processed: 2, accepted: 2 });
  });
  assert.deepEqual(calls.map((call) => call.method), ["finalize", "respond", "processDue"]);
  assert.deepEqual(calls[0]?.args, ["competition-1", now.toISOString()]);
  assert.deepEqual(calls[1]?.args, ["user-1", "offer-1", true, now.toISOString()]);
  assert.deepEqual(calls[2]?.args, [now.toISOString(), 10]);
});

test("pyramid league overview and club history use the Supabase request scope", async () => {
 const calls: Array<{ method: string; args: unknown[] }> = [];
 await withPyramidLeagueSettlementPort(fakePort(calls), async () => {
  const service = await import("../src/game/league-pyramid-service.js");
  const overview = await service.listPyramidLeagues("user-1");
  const history = await service.getPyramidLeagueClubHistory("user-1");
  assert.equal(overview.season, 2027);
  assert.ok(history.stats);
 });
 assert.deepEqual(calls.map((call) => call.method), ["listLeagues", "getClubHistory"]);
});

test("pyramid league details and notice operations use the Supabase request scope", async () => {
 const calls: Array<{ method: string; args: unknown[] }> = [];
 const service = await import("../src/game/league-pyramid-service.js");
 await withPyramidLeagueSettlementPort(fakePort(calls), async () => {
  await service.getPyramidLeagueDetails("user-1", "league-1");
  await service.listLeagueNotices("user-1");
  await service.markLeagueNoticesRead("user-1");
 });
 assert.deepEqual(calls.map((call) => call.method), ["getLeagueDetails", "listNotices", "markNoticesRead"]);
 assert.deepEqual(calls[0]?.args, ["user-1", "league-1"]);
 assert.equal((calls[2]?.args[1] as string).length, 24);
});
