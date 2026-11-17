import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { registerSeasonAwardRoutes, type SeasonAwardRepository } from "../../../apps/api/src/game/season-award-routes.js";

type Handler = (request: { params: Record<string, unknown>; query: Record<string, unknown> }, reply: {
  code(status: number): { send(body: unknown): unknown };
}) => Promise<unknown>;
function capture(repository: SeasonAwardRepository) {
  let handler: Handler | undefined;
  const app = { get(path: string, callback: Handler) {
    assert.equal(path, "/v1/seasons/:season/awards"); handler = callback;
  } } as unknown as FastifyInstance;
  registerSeasonAwardRoutes(app, repository);
  assert.ok(handler);
  return handler;
}
const record = { playerId: "p1", playerName: "Alex", position: "ST", clubName: "Tosan", appearances: 8, goals: 7, assists: 2, minutesPlayed: 700, averageRating: 8.4 };
test("season awards route keeps response shape, manual awards, minimum appearances and team selection", async () => {
  const calls: number[] = [];
  const handler = capture({ async getSeasonData(season) {
    calls.push(season);
    return { matches: 10, records: [record, { ...record, playerId: "p2", playerName: "Keeper", position: "GK", goals: 1, averageRating: 7.9 }], manualAwards: [{ id: "a1", awardType: "SPECIAL", awardName: "Special award", reason: null, playerId: "p1", playerName: "Alex", position: "ST", clubName: "Tosan" }] };
  } });
  const response = await handler({ params: { season: "2026" }, query: { minimumAppearances: "3" } }, { code(status) { throw new Error("Unexpected status " + status); } });
  assert.deepEqual(calls, [2026]);
  assert.deepEqual(response, {
    season: 2026, matches: 10, minimumAppearances: 3,
    awards: { topScorer: record, topAssists: record, playerOfSeason: record, teamOfSeason: [{ ...record, playerId: "p2", playerName: "Keeper", position: "GK", goals: 1, averageRating: 7.9 }, record] },
    manualAwards: [{ id: "a1", awardType: "SPECIAL", awardName: "Special award", reason: null, playerId: "p1", playerName: "Alex", position: "ST", clubName: "Tosan" }],
    leaders: { scorers: [record, { ...record, playerId: "p2", playerName: "Keeper", position: "GK", goals: 1, averageRating: 7.9 }], assists: [record], ratings: [{ ...record, playerId: "p2", playerName: "Keeper", position: "GK", goals: 1, averageRating: 7.9 }, record] },
  });
});
test("season awards route rejects invalid query parameters", async () => {
  const handler = capture({ async getSeasonData() { throw new Error("must not be called"); } });
  let status = 0;
  const response = await handler({ params: { season: "2026" }, query: { unexpected: "x" } }, { code(value) { status = value; return { send(body) { return body; } }; } });
  assert.equal(status, 400);
  assert.deepEqual(response, { error: "INVALID_SEASON_AWARDS_QUERY" });
});
