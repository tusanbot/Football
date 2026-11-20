import { SupabaseHttpClient } from "../node-supabase-http.js";
import { SupabaseMatchRuntimeAdvanceRepository } from "./node-supabase-match-runtime-advance.js";
import { SupabaseMatchRuntimeCheckpointRepository } from "./node-supabase-match-runtime-checkpoint.js";
import { SupabaseMatchRuntimeEnqueueRepository } from "./node-supabase-match-runtime-enqueue.js";
import { SupabaseMatchRuntimeForfeitRepository } from "./node-supabase-match-runtime-forfeit.js";
import { SupabaseMatchRuntimeLeaseRepository } from "./node-supabase-match-runtime-lease.js";
import { SupabaseMatchRuntimeSettlementRepository } from "./node-supabase-match-runtime-settlement.js";
import { SupabaseMatchRuntimeSnapshotRepository } from "./node-supabase-match-runtime-snapshot.js";
import { SupabaseCompetitionCreationRepository } from "./node-supabase-competition-creation.js";
import { SupabaseCompetitionReadRepository } from "./node-supabase-competition-read.js";
import { SupabaseCompetitionAdvancementRepository } from "./node-supabase-competition-advancement.js";
import { SupabaseFriendlyMatchCreationRepository } from "./node-supabase-friendly-match-creation.js";
import { SupabaseClubLineupRepository } from "./node-supabase-club-lineup.js";
import { SupabaseClubTicketPriceRepository } from "./node-supabase-club-ticket-price.js";
import { SupabaseClubMatchReadRepository } from "./node-supabase-club-match-read.js";
import { SupabaseMatchOpponentRepository } from "./node-supabase-match-opponents.js";
import { SupabaseEventTournamentSettlementRepository } from "./node-supabase-event-tournament-settlement.js";
import { SupabasePyramidLeagueSettlementRepository } from "./node-supabase-pyramid-league-settlement.js";
import { withMatchRuntimeAdvancePort } from "./match-runtime-advance-context.js";
import { withMatchRuntimeCheckpointPort } from "./match-runtime-checkpoint-context.js";
import { withMatchRuntimeEnqueuePort } from "./match-runtime-enqueue-context.js";
import { withMatchRuntimeForfeitPort } from "./match-runtime-forfeit-context.js";
import { withMatchRuntimeLeasePort } from "./match-runtime-lease-context.js";
import { withMatchRuntimeSettlementPort } from "./match-runtime-settlement-context.js";
import { withMatchRuntimeSnapshotPort } from "./match-runtime-snapshot-context.js";
import { withCompetitionCreationPort } from "./competition-creation-context.js";
import { withCompetitionReadPort } from "./competition-read-context.js";
import { withCompetitionAdvancementPort } from "./competition-advancement-context.js";
import { withFriendlyMatchCreationPort } from "./friendly-match-creation-context.js";
import { withClubLineupPort } from "./club-lineup-context.js";
import { withClubTicketPricePort } from "./club-ticket-price-context.js";
import { withClubMatchReadPort } from "./club-match-read-context.js";
import { withMatchOpponentPort } from "./match-opponents-context.js";
import { withEventTournamentSettlementPort } from "../event-tournament-settlement-context.js";
import { withPyramidLeagueSettlementPort } from "./pyramid-league-settlement-context.js";

export function createNodeSupabaseMatchPorts(client: SupabaseHttpClient) {
 return {
  advance:new SupabaseMatchRuntimeAdvanceRepository(client),
  checkpoint:new SupabaseMatchRuntimeCheckpointRepository(client),
  enqueue:new SupabaseMatchRuntimeEnqueueRepository(client),
  forfeit:new SupabaseMatchRuntimeForfeitRepository(client),
  lease:new SupabaseMatchRuntimeLeaseRepository(client),
  settlement:new SupabaseMatchRuntimeSettlementRepository(client),
  snapshot:new SupabaseMatchRuntimeSnapshotRepository(client),
  competitionCreation:new SupabaseCompetitionCreationRepository(client),
  competitionRead:new SupabaseCompetitionReadRepository(client),
  competitionAdvancement:new SupabaseCompetitionAdvancementRepository(client),
  friendlyMatch:new SupabaseFriendlyMatchCreationRepository(client),
  clubLineup:new SupabaseClubLineupRepository(client),
  clubTicketPrice:new SupabaseClubTicketPriceRepository(client),
  clubMatchRead:new SupabaseClubMatchReadRepository(client),
  matchOpponents:new SupabaseMatchOpponentRepository(client),
  eventTournament:new SupabaseEventTournamentSettlementRepository(client),
  pyramidLeague:new SupabasePyramidLeagueSettlementRepository(client),
 };
}
export type NodeSupabaseMatchPorts = ReturnType<typeof createNodeSupabaseMatchPorts>;

export function withNodeSupabaseMatchPorts<T>(ports:NodeSupabaseMatchPorts,operation:()=>Promise<T>):Promise<T>{
 let run:()=>Promise<T>=operation;
 const wrap=(next:()=>Promise<T>,scope:(operation:()=>Promise<T>)=>Promise<T>)=>()=>scope(next);
 run=wrap(run,next=>withPyramidLeagueSettlementPort(ports.pyramidLeague,next));
 run=wrap(run,next=>withEventTournamentSettlementPort(ports.eventTournament,next));
 run=wrap(run,next=>withMatchOpponentPort(ports.matchOpponents,next));
 run=wrap(run,next=>withClubMatchReadPort(ports.clubMatchRead,next));
 run=wrap(run,next=>withClubTicketPricePort(ports.clubTicketPrice,next));
 run=wrap(run,next=>withClubLineupPort(ports.clubLineup,next));
 run=wrap(run,next=>withFriendlyMatchCreationPort(ports.friendlyMatch,next));
 run=wrap(run,next=>withCompetitionAdvancementPort(ports.competitionAdvancement,next));
 run=wrap(run,next=>withCompetitionCreationPort(ports.competitionCreation,next));
 run=wrap(run,next=>withCompetitionReadPort(ports.competitionRead,next));
 run=wrap(run,next=>withMatchRuntimeSnapshotPort(ports.snapshot,next));
 run=wrap(run,next=>withMatchRuntimeSettlementPort(ports.settlement,next));
 run=wrap(run,next=>withMatchRuntimeLeasePort(ports.lease,next));
 run=wrap(run,next=>withMatchRuntimeForfeitPort(ports.forfeit,next));
 run=wrap(run,next=>withMatchRuntimeEnqueuePort(ports.enqueue,next));
 run=wrap(run,next=>withMatchRuntimeCheckpointPort(ports.checkpoint,next));
 run=wrap(run,next=>withMatchRuntimeAdvancePort(ports.advance,next));
 return run();
}
