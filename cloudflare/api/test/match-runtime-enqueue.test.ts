import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseMatchRuntimeEnqueueRepository } from "../src/repositories/match-runtime-enqueue.js";

function club(id: string, ownerId: string) {
  return {
    id, ownerId, name: id, formation: "4-3-3", mentality: "BALANCED",
    pressing: "MEDIUM", tempo: "NORMAL", passingStyle: "MIXED",
    stadiumLevel: 1, ticketPrice: "100", reputation: 0, matchFallbackPlan: null,
    coachMedicalSkill: 0,
    players: Array.from({ length: 11 }, (_, index) => ({
      id: id + "-p" + index, firstName: "Player", lastName: String(index),
      position: index === 0 ? "GK" : "CM", overall: 60, lineupSlot: index,
      morale: 70, fitness: 90, attributes: {}, suspensionMatchesRemaining: 0,
    })),
  };
}

test("match runtime enqueue reads due fixtures and writes JSON-safe snapshots through RPCs", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "get_due_match_runtime_fixtures") return [{
        match_id: "match-1", scheduled_at: "2026-11-18T20:00:00.000Z",
        home_club: club("home", "owner-home"), away_club: club("away", "owner-away"),
      }];
      if (name === "enqueue_match_runtime_snapshots") return 1;
      throw new Error("UNEXPECTED_RPC:" + name);
    },
  } as never;
  const repository = new SupabaseMatchRuntimeEnqueueRepository(client);
  const result = await repository.enqueue("2026-11-18T20:00:00.000Z", 10);
  assert.deepEqual(result, { enqueued: 1, invalidFixtures: [] });
  assert.equal(calls[0]?.name, "get_due_match_runtime_fixtures");
  assert.deepEqual(calls[0]?.args, { p_now: "2026-11-18T20:00:00.000Z", p_limit: 10 });
  assert.equal(calls[1]?.name, "enqueue_match_runtime_snapshots");
  const rows = calls[1]?.args.p_rows as Array<{ match_id: string; kickoff_snapshot: { home: { ticketPrice: string } } }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.match_id, "match-1");
  assert.equal(rows[0]?.kickoff_snapshot.home.ticketPrice, "100");
});

test("match runtime enqueue records fixtures without a valid goalkeeper as invalid", async () => {
  const invalidHome = club("home", "owner-home");
  invalidHome.players = invalidHome.players.map((player) => ({ ...player, position: "CM" }));
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "get_due_match_runtime_fixtures") return [{
        match_id: "match-invalid", scheduled_at: "2026-11-18T20:00:00.000Z",
        home_club: invalidHome, away_club: club("away", "owner-away"),
      }];
      return 0;
    },
  } as never;
  const repository = new SupabaseMatchRuntimeEnqueueRepository(client);
  const result = await repository.enqueue("2026-11-18T20:00:00.000Z", 5);
  assert.deepEqual(result, { enqueued: 0, invalidFixtures: [{ id: "match-invalid", ownerId: "owner-home" }] });
  assert.deepEqual(calls, ["get_due_match_runtime_fixtures"]);
});

test("match runtime enqueue rejects malformed fixture RPC responses", async () => {
  const repository = new SupabaseMatchRuntimeEnqueueRepository({ rpc: async () => [{ match_id: "missing" }] } as never);
  await assert.rejects(() => repository.enqueue("2026-11-18T20:00:00.000Z", 5), /SUPABASE_MATCH_RUNTIME_FIXTURE_INVALID/);
});

test("match runtime enqueue rejects invalid insert counts", async () => {
  const client = {
    rpc: async (name: string) => name === "get_due_match_runtime_fixtures" ? [{
      match_id: "match-1", scheduled_at: "2026-11-18T20:00:00.000Z",
      home_club: club("home", "owner-home"), away_club: club("away", "owner-away"),
    }] : "one",
  } as never;
  const repository = new SupabaseMatchRuntimeEnqueueRepository(client);
  await assert.rejects(() => repository.enqueue("2026-11-18T20:00:00.000Z", 5), /SUPABASE_MATCH_RUNTIME_ENQUEUE_INVALID_RESPONSE/);
});
