import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLeaguePlayerValue, chargeDailyChallenge, leagueTier, resolveLeaguePromotion,
  resolvePromotionDecline,
} from "@football/domain";

const standings = Array.from({ length: 8 }, (_, index) => ({
  clubId: "club-" + (index + 1), clubName: "Club " + (index + 1),
  points: 21 - index * 3, goalDifference: 12 - index * 2, goalsFor: 20 - index,
  wins: 7 - index,
}));

test("national pyramid has seven named tiers", () => {
  assert.equal(leagueTier(1).name, "لیگ پایه");
  assert.equal(leagueTier(7).name, "لیگ قهرمانان");
  assert.throws(() => leagueTier(8), /INVALID_LEAGUE_TIER/);
});

test("pyramid season ranking promotes two and relegates two from an eight-team league", () => {
  const result = resolveLeaguePromotion(standings, 4);
  assert.deepEqual(result.promoted.map((team) => team.clubId), ["club-1", "club-2"]);
  assert.deepEqual(result.relegated.map((team) => team.clubId), ["club-7", "club-8"]);
  assert.equal(result.champion.clubId, "club-1");
  assert.equal(result.runnerUp.clubId, "club-2");
  assert.equal(result.thirdPlace.clubId, "club-3");
  assert.throws(() => resolveLeaguePromotion(standings.slice(0, 7), 4), /PYRAMID_LEAGUE_REQUIRES_EIGHT_TEAMS/);
});

test("declined promotion slot is offered to the next eligible team", () => {
  const result = resolvePromotionDecline(standings, ["club-1"], 3);
  assert.deepEqual(result.promoted, ["club-2", "club-3"]);
  assert.deepEqual(result.declined, ["club-1"]);
  assert.deepEqual(result.replacements, ["club-3"]);
});

test("player market value rises on promotion and falls on relegation", () => {
  const original = 1000n;
  assert.ok(calculateLeaguePlayerValue(original, 1, 2) > original);
  assert.ok(calculateLeaguePlayerValue(original, 5, 4) < original);
  assert.equal(calculateLeaguePlayerValue(original, 3, 3), original);
});

test("daily friendly challenge allowance is three free then two Gold", () => {
  let usage = { freeUsed: 0, goldUsed: 0, purchasedUsed: 0 };
  const charges = [];
  for (let index = 0; index < 5; index++) {
    const result = chargeDailyChallenge(usage, 100n);
    charges.push(result.asset);
    usage = result.nextUsage;
  }
  assert.deepEqual(charges, ["FREE", "FREE", "FREE", "GOLD", "GOLD"]);
  assert.throws(() => chargeDailyChallenge(usage, 100n), /DAILY_CHALLENGE_LIMIT_REACHED/);
});

test("purchased challenge credits are consumed after the daily free and Gold allowance", () => {
  const result = chargeDailyChallenge({ freeUsed: 3, goldUsed: 2, purchasedUsed: 2 }, 100n);
  assert.equal(result.asset, "PURCHASED");
  assert.equal(result.nextUsage.purchasedUsed, 1);
});
