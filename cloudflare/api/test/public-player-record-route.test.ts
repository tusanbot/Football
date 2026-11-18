import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import {
  registerPublicPlayerRecordRoutes,
  type PublicPlayerRecord,
  type PublicPlayerRecordMetric,
  type PublicPlayerRecordRepository,
} from "../../../apps/api/src/players/public-record-routes.js";

type RouteHandler = (request: { query: Record<string, unknown> }, reply: {
  code(status: number): { send(body: unknown): unknown };
}) => Promise<unknown>;

function captureRoute(repository: PublicPlayerRecordRepository) {
  let handler: RouteHandler | undefined;
  const app = {
    get(path: string, callback: RouteHandler) {
      assert.equal(path, "/v1/players/records");
      handler = callback;
    },
  } as unknown as FastifyInstance;
  registerPublicPlayerRecordRoutes(app, repository);
  assert.ok(handler, "route handler should be registered");
  return handler;
}

const fixture: PublicPlayerRecord[] = [{
  playerId: "player-1",
  playerName: "Alex Striker",
  position: "ST",
  overall: 88,
  clubName: "Tosan FC",
  appearances: 12,
  goals: 9,
  assists: 3,
  minutesPlayed: 980,
  averageRating: 8.35,
  value: 9,
}];

test("public player records HTTP route preserves the legacy response envelope with an injected repository", async () => {
  const calls: Array<{ metric: PublicPlayerRecordMetric; limit: number }> = [];
  const repository: PublicPlayerRecordRepository = {
    async list(metric, limit) {
      calls.push({ metric, limit });
      return fixture;
    },
  };
  const handler = captureRoute(repository);
  const response = await handler({ query: { metric: "goals", limit: "10" } }, {
    code(status) { throw new Error("Unexpected HTTP status: " + status); },
  });

  assert.deepEqual(calls, [{ metric: "goals", limit: 10 }]);
  assert.deepEqual(response, {
    metric: "goals",
    minimumAppearances: 1,
    records: [{ rank: 1, ...fixture[0] }],
  });
});

test("public player records HTTP route applies rating eligibility metadata and query defaults", async () => {
  const calls: Array<{ metric: PublicPlayerRecordMetric; limit: number }> = [];
  const handler = captureRoute({
    async list(metric, limit) {
      calls.push({ metric, limit });
      return fixture;
    },
  });
  const response = await handler({ query: { metric: "rating" } }, {
    code(status) { throw new Error("Unexpected HTTP status: " + status); },
  });

  assert.deepEqual(calls, [{ metric: "rating", limit: 20 }]);
  assert.deepEqual(response, {
    metric: "rating",
    minimumAppearances: 3,
    records: [{ rank: 1, ...fixture[0] }],
  });
});

test("public player records HTTP route rejects unknown query fields", async () => {
  const handler = captureRoute({
    async list() { throw new Error("Repository must not be called for invalid input"); },
  });
  let status = 0;
  let body: unknown;
  const response = await handler({ query: { metric: "goals", unexpected: "value" } }, {
    code(value) {
      status = value;
      return { send(payload) { body = payload; return payload; } };
    },
  });

  assert.equal(status, 400);
  assert.deepEqual(body, { error: "INVALID_PLAYER_RECORD_QUERY" });
  assert.deepEqual(response, body);
});
