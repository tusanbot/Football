import assert from "node:assert/strict";
import test from "node:test";
import {
  EventTournamentSettlementUnavailableError,
  finalizeEventTournamentFromCompetition,
  processDueEventTournamentFinalizations,
} from "../src/event-tournament-service.js";
import { withEventTournamentSettlementPort } from "../src/event-tournament-settlement-context.js";

test("event tournament prize settlement fails closed without the Supabase port", async () => {
  await assert.rejects(
    finalizeEventTournamentFromCompetition("competition-1"),
    EventTournamentSettlementUnavailableError,
  );
  await assert.rejects(
    processDueEventTournamentFinalizations(),
    EventTournamentSettlementUnavailableError,
  );
});

test("event tournament finalization delegates atomic prize settlement to Supabase", async () => {
  const calls: unknown[] = [];
  await withEventTournamentSettlementPort({
    async finalize(competitionId, now) {
      calls.push({ operation: "finalize", competitionId, now });
      return { finalized: true, replayed: false, participants: 8, awards: 12 };
    },
    async processDue(now, limit) {
      calls.push({ operation: "processDue", now, limit });
      return { candidates: 2, finalized: 2, failed: 0 };
    },
  }, async () => {
    assert.deepEqual(
      await finalizeEventTournamentFromCompetition("competition-1", new Date("2026-11-20T09:00:00.000Z")),
      { finalized: true, replayed: false, participants: 8, awards: 12 },
    );
    assert.deepEqual(
      await processDueEventTournamentFinalizations(new Date("2026-11-20T09:05:00.000Z"), 5),
      { candidates: 2, finalized: 2, failed: 0 },
    );
  });
  assert.deepEqual(calls, [
    { operation: "finalize", competitionId: "competition-1", now: "2026-11-20T09:00:00.000Z" },
    { operation: "processDue", now: "2026-11-20T09:05:00.000Z", limit: 5 },
  ]);
});
