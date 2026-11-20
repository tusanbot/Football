import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../src/node-supabase-http.js";
import { SupabaseEventTournamentSettlementRepository } from "../src/game/node-supabase-event-tournament-settlement.js";

test("event tournament retry RPC reports candidate-level finalization failures", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "event-tournament-service-role-test-key",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ candidates: 4, finalized: 2, failed: 2 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  });
  const repository = new SupabaseEventTournamentSettlementRepository(client);
  assert.deepEqual(await repository.processDue("2026-11-20T12:34:56.789Z", 8), {
    candidates: 4, finalized: 2, failed: 2,
  });
  assert.equal(new URL(requestUrl).pathname, "/rest/v1/rpc/process_due_event_tournament_finalizations_http");
  assert.deepEqual(requestBody, { p_now: "2026-11-20T12:34:56.789Z", p_limit: 8 });
});

test("event tournament retry RPC rejects incomplete failure metrics", async () => {
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "event-tournament-service-role-test-key",
    fetchImpl: async () => new Response(JSON.stringify({ candidates: 4, finalized: 2 }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  });
  const repository = new SupabaseEventTournamentSettlementRepository(client);
  await assert.rejects(repository.processDue("2026-11-20T12:34:56.789Z", 8),
    /SUPABASE_EVENT_TOURNAMENT_BATCH_REJECTED/);
});
