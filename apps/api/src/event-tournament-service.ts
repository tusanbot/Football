import { getEventTournamentSettlementPort } from "./event-tournament-settlement-context.js";

export class EventTournamentSettlementUnavailableError extends Error {
  constructor() {
    super("SUPABASE_EVENT_TOURNAMENT_SETTLEMENT_UNAVAILABLE");
    this.name = "EventTournamentSettlementUnavailableError";
  }
}

/** Prize distribution and completion are performed atomically by the Supabase RPC. */
export async function finalizeEventTournamentFromCompetition(competitionId: string, now = new Date()) {
  const port = getEventTournamentSettlementPort();
  if (!port) throw new EventTournamentSettlementUnavailableError();
  if (!competitionId.trim()) throw new TypeError("INVALID_COMPETITION_ID");
  return port.finalize(competitionId, now.toISOString());
}

/** Retry completed competitions whose Supabase prize settlement was interrupted. */
export async function processDueEventTournamentFinalizations(now = new Date(), limit = 1) {
  const port = getEventTournamentSettlementPort();
  if (!port) throw new EventTournamentSettlementUnavailableError();
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RangeError("INVALID_EVENT_TOURNAMENT_BATCH_LIMIT");
  return port.processDue(now.toISOString(), limit);
}
