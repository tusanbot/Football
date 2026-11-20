import assert from "node:assert/strict";
import test from "node:test";
import { processDueMatchRuntimes } from "../src/game/match-service.js";
import { advanceMatchSegment, defaultMatchRules, type MatchSegmentState, type MatchSide, type MatchSubstitutionState } from "@football/domain";
import { withMatchRuntimeEnqueuePort } from "../src/game/match-runtime-enqueue-context.js";
import { withMatchRuntimeLeasePort } from "../src/game/match-runtime-lease-context.js";
import { withMatchRuntimeSnapshotPort } from "../src/game/match-runtime-snapshot-context.js";
import { withMatchRuntimeForfeitPort } from "../src/game/match-runtime-forfeit-context.js";
import { withMatchRuntimeSettlementPort, type MatchRuntimeSettlementResult } from "../src/game/match-runtime-settlement-context.js";

async function withTestEnvironment<T>(operation: () => Promise<T>): Promise<T> {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnvironment = process.env.ENVIRONMENT;
  process.env.NODE_ENV = "test";
  delete process.env.ENVIRONMENT;
  try { return await operation(); }
  finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
  }
}

test("match worker coordinator delegates enqueue, lease claim and runtime lookup to scoped Supabase ports", async () => {
  await withTestEnvironment(async () => {
    const calls: string[] = [];
    const now = new Date("2026-11-20T12:00:00.000Z");
    const result = await withMatchRuntimeEnqueuePort({
      async enqueue(at, limit) {
        calls.push("enqueue");
        assert.equal(at, now.toISOString());
        assert.equal(limit, 10);
        return { enqueued: 2, invalidFixtures: [] };
      },
    }, () => withMatchRuntimeLeasePort({
      async claim(input) {
        calls.push("claim");
        assert.equal(input.workerId, "supabase-worker-test");
        assert.equal(input.now, now.toISOString());
        assert.equal(input.leaseMs, 60_000);
        assert.equal(input.limit, 3);
        return [{
          runtime: { id: "runtime-through-supabase" },
          lease: { owner: input.workerId, token: "lease-through-supabase", expiresAt: new Date(now.getTime() + 60_000) },
        }];
      },
      async release() {
        calls.push("release");
        return true;
      },
    }, () => withMatchRuntimeSnapshotPort({
      async get(runtimeId) {
        calls.push("snapshot");
        assert.equal(runtimeId, "runtime-through-supabase");
        // A missing runtime is treated as already settled/deleted; no Prisma lookup is attempted.
        return null;
      },
    }, () => processDueMatchRuntimes("supabase-worker-test", now, 3))));

    assert.deepEqual(calls, ["enqueue", "claim", "snapshot"]);
    assert.deepEqual(result, { enqueued: 2, claimed: 1, advanced: 0, waiting: 0, settled: 1, failed: 0 });
  });
});

test("match worker routes invalid kickoff snapshots to the Supabase forfeit port instead of legacy simulation", async () => {
  await withTestEnvironment(async () => {
    const calls: string[] = [];
    const now = new Date("2026-11-20T12:00:00.000Z");
    const result = await withMatchRuntimeEnqueuePort({
      async enqueue() {
        calls.push("enqueue");
        return { enqueued: 0, invalidFixtures: [{ id: "invalid-match", ownerId: "club-owner" }] };
      },
    }, () => withMatchRuntimeForfeitPort({
      async forfeit(matchId, at) {
        calls.push("forfeit");
        assert.equal(matchId, "invalid-match");
        assert.equal(at, now.toISOString());
        return {
          settled: true, replayed: false, matchId, competitionId: null, round: null,
          competitionFormat: null, advancement: null, pyramidFinalization: null, eventTournamentFinalization: null,
        };
      },
    }, () => processDueMatchRuntimes("supabase-worker-test", now, 3, { claim: false })));

    assert.deepEqual(calls, ["enqueue", "forfeit"]);
    assert.deepEqual(result, { enqueued: 0, claimed: 0, advanced: 0, waiting: 0, settled: 0, failed: 0 });
  });
});

test("match worker advances a due kickoff through the Supabase first-half RPC and releases its lease", async () => {
  await withTestEnvironment(async () => {
    const calls: string[] = [];
    const now = new Date("2026-11-20T12:00:00.000Z");
    const makeSide = (id: string) => ({
      clubId: id, clubName: id, formation: "4-3-3",
      tactics: { mentality: "BALANCED", pressing: "NORMAL", tempo: "NORMAL", passingStyle: "MIXED" },
      stadiumCapacity: 20_000, ticketPrice: "250", reputation: 100, coachMedicalSkill: 0,
      players: Array.from({ length: 11 }, (_, index) => ({
        id: id + "-player-" + index, name: "Player " + index,
        position: index === 0 ? "GK" : index === 1 ? "CB" : "ST",
        overall: 70, morale: 80, fitness: 95,
        attributes: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70, goalkeeping: index === 0 ? 75 : 20 },
      })),
      bench: [],
    });
    const snapshot = {
      id: "runtime-kickoff", matchId: "match-kickoff", status: "PENDING",
      currentMinute: 0, stateVersion: 7, leaseToken: "lease-kickoff",
      simulationState: null, startedAt: null, fallbackPlan: null,
      kickoffSnapshot: { home: makeSide("home"), away: makeSide("away") },
      match: {
        id: "match-kickoff", status: "SCHEDULED", seed: "stable-seed",
        type: "FRIENDLY", rulesSnapshot: null, homeClubId: "home", awayClubId: "away",
        startedAt: null, competition: null, firstLeg: null,
      },
    };
    const result = await withMatchRuntimeEnqueuePort({
      async enqueue() { calls.push("enqueue"); return { enqueued: 0, invalidFixtures: [] }; },
    }, () => withMatchRuntimeLeasePort({
      async claim(input) {
        calls.push("claim");
        assert.equal(input.workerId, "supabase-worker-test");
        return [{
          runtime: { id: "runtime-kickoff" },
          lease: { owner: input.workerId, token: "lease-kickoff", expiresAt: new Date(now.getTime() + 60_000) },
        }];
      },
      async release(input) {
        calls.push("release");
        assert.equal(input.runtimeId, "runtime-kickoff");
        assert.equal(input.leaseToken, "lease-kickoff");
        assert.equal(input.nextActionAt, new Date(now.getTime() + 5_000).toISOString());
        assert.equal(input.lastError, null);
        return true;
      },
    }, () => withMatchRuntimeSnapshotPort({
      async get(runtimeId) {
        calls.push("snapshot");
        assert.equal(runtimeId, "runtime-kickoff");
        return snapshot;
      },
    }, () => withMatchRuntimeAdvancePort({
      async advanceFirstHalf(input) {
        calls.push("advance-first-half");
        assert.equal(input.runtimeId, "runtime-kickoff");
        assert.equal(input.expectedStateVersion, 7);
        assert.equal(input.leaseToken, "lease-kickoff");
        assert.equal(input.startedAt, now.toISOString());
        assert.equal(input.checkpointAt, new Date(now.getTime() + 45_000).toISOString());
        assert.equal(input.decisionDeadlineAt, new Date(now.getTime() + 50_000).toISOString());
        assert.equal((input.simulationState as { segment: { currentMinute: number } }).segment.currentMinute, 45);
        assert.equal(input.events.some(event => event.eventKey === "kickoff" && event.kind === "KICKOFF"), true);
        return true;
      },
    }, () => processDueMatchRuntimes("supabase-worker-test", now, 1, { enqueue: false })))));

    assert.deepEqual(calls, ["claim", "snapshot", "advance-first-half", "release"]);
    assert.deepEqual(result, { enqueued: 0, claimed: 1, advanced: 1, waiting: 0, settled: 0, failed: 0 });
  });
});


test("match worker resolves a tactical checkpoint from both clubs through one Supabase atomic command", async () => {
  await withTestEnvironment(async () => {
    const calls: string[] = [];
    const kickoffAt = new Date("2026-11-20T12:00:00.000Z");
    const checkpointNow = new Date(kickoffAt.getTime() + 60_000);
    const makeSide = (id: string) => ({
      clubId: id, clubName: id, formation: "4-3-3",
      tactics: { mentality: "BALANCED", pressing: "NORMAL", tempo: "NORMAL", passingStyle: "MIXED" },
      stadiumCapacity: 20_000, ticketPrice: "250", reputation: 100, coachMedicalSkill: 0,
      players: Array.from({ length: 11 }, (_, index) => ({
        id: id + "-player-" + index, name: "Player " + index,
        position: index === 0 ? "GK" : index === 1 ? "CB" : "ST",
        overall: 70, morale: 80, fitness: 95,
        attributes: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70, goalkeeping: index === 0 ? 75 : 20 },
      })),
      bench: [],
    });
    const kickoffSnapshot = { home: makeSide("home"), away: makeSide("away") };
    let savedSimulationState: unknown;
    const firstHalfRuntime = {
      id: "runtime-checkpoint", matchId: "match-checkpoint", status: "PENDING",
      currentMinute: 0, stateVersion: 4, leaseToken: "lease-checkpoint",
      simulationState: null, startedAt: null, fallbackPlan: null, kickoffSnapshot,
      match: {
        id: "match-checkpoint", status: "SCHEDULED", seed: "checkpoint-seed",
        type: "FRIENDLY", rulesSnapshot: null, homeClubId: "home", awayClubId: "away",
        startedAt: null, competition: null, firstLeg: null,
      },
    };
    await withMatchRuntimeEnqueuePort({
      async enqueue() { return { enqueued: 0, invalidFixtures: [] }; },
    }, () => withMatchRuntimeLeasePort({
      async claim(input) {
        return [{ runtime: { id: "runtime-checkpoint" }, lease: {
          owner: input.workerId, token: "lease-checkpoint", expiresAt: new Date(kickoffAt.getTime() + 60_000),
        } }];
      },
      async release() { return true; },
    }, () => withMatchRuntimeSnapshotPort({
      async get() { return firstHalfRuntime; },
    }, () => withMatchRuntimeAdvancePort({
      async advanceFirstHalf(input) {
        calls.push("first-half");
        savedSimulationState = input.simulationState;
        return true;
      },
    }, () => processDueMatchRuntimes("checkpoint-worker", kickoffAt, 1, { enqueue: false })))));

    assert.ok(savedSimulationState);
    const runtimeAtCheckpoint = {
      ...firstHalfRuntime, status: "RUNNING", currentMinute: 45, stateVersion: 5,
      leaseToken: "lease-checkpoint", simulationState: savedSimulationState, startedAt: kickoffAt,
      match: { ...firstHalfRuntime.match, status: "IN_PROGRESS", startedAt: kickoffAt },
    };
    const checkpoint = {
      checkpoint: {
        id: "checkpoint-45", checkpointKey: "minute-45", kind: "HALF_TIME",
        minute: 45, status: "OPEN", openedAt: new Date(kickoffAt.getTime() + 45_000).toISOString(),
        decisionDeadlineAt: new Date(kickoffAt.getTime() + 50_000).toISOString(),
        nextSegmentAt: new Date(kickoffAt.getTime() + 50_000).toISOString(),
      },
      decisions: [
        { id: "home-decision", clubId: "home", submittedAt: new Date(kickoffAt.getTime() + 46_000).toISOString(), instruction: {} },
        { id: "away-decision", clubId: "away", submittedAt: new Date(kickoffAt.getTime() + 47_000).toISOString(), instruction: {} },
      ],
    };
    const result = await withMatchRuntimeEnqueuePort({
      async enqueue() { throw new Error("enqueue must be skipped"); },
    }, () => withMatchRuntimeLeasePort({
      async claim(input) {
        calls.push("claim");
        assert.equal(input.now, checkpointNow.toISOString());
        return [{ runtime: { id: "runtime-checkpoint" }, lease: {
          owner: input.workerId, token: "lease-checkpoint", expiresAt: new Date(checkpointNow.getTime() + 60_000),
        } }];
      },
      async release(input) {
        calls.push("release");
        assert.equal(input.runtimeId, "runtime-checkpoint");
        assert.equal(input.leaseToken, "lease-checkpoint");
        assert.equal(input.nextActionAt, new Date(checkpointNow.getTime() + 5_000).toISOString());
        assert.equal(input.lastError, null);
        return true;
      },
    }, () => withMatchRuntimeSnapshotPort({
      async get(runtimeId) {
        calls.push("snapshot");
        assert.equal(runtimeId, "runtime-checkpoint");
        return runtimeAtCheckpoint;
      },
    }, () => withMatchRuntimeCheckpointPort({
      async getOpenCheckpoint(matchId) {
        calls.push("checkpoint-read");
        assert.equal(matchId, "match-checkpoint");
        return checkpoint;
      },
      async resolveCheckpoint(input) {
        calls.push("checkpoint-resolve");
        assert.equal(input.runtimeId, "runtime-checkpoint");
        assert.equal(input.checkpointId, "checkpoint-45");
        assert.equal(input.expectedStateVersion, 5);
        assert.equal(input.leaseToken, "lease-checkpoint");
        assert.equal(input.nextMinute, 60);
        assert.equal((input.simulationState as { segment: { currentMinute: number } }).segment.currentMinute, 60);
        assert.equal(input.nextCheckpoint?.checkpointKey, "minute-60");
        assert.equal(input.nextCheckpoint?.kind, "MINUTE_60");
        assert.equal(input.events.some(event => event.eventKey === "halftime" && event.kind === "HALF_TIME"), true);
        const resolution = input.resolution as { home: { source: string }; away: { source: string } };
        assert.equal(resolution.home.source, "MANAGER");
        assert.equal(resolution.away.source, "MANAGER");
        return true;
      },
      async submitDecision() { throw new Error("decision submission is not part of worker resolution"); },
      async enqueueLifecycleEvents() { throw new Error("lifecycle enqueue should be included in atomic resolution"); },
    }, () => processDueMatchRuntimes("checkpoint-worker", checkpointNow, 1, { enqueue: false })))));

    assert.deepEqual(calls, ["first-half", "claim", "snapshot", "checkpoint-read", "checkpoint-resolve", "release"]);
    assert.deepEqual(result, { enqueued: 0, claimed: 1, advanced: 1, waiting: 0, settled: 0, failed: 0 });
  });
});


test("match worker settles a completed 90-minute runtime through the atomic Supabase settlement port", async () => {
  await withTestEnvironment(async () => {
    const calls: string[] = [];
    const now = new Date("2026-11-20T14:00:00.000Z");
    const kickoffAt = new Date(now.getTime() - 90_000);
    const makeSide = (id: string): MatchSide => ({
      clubId: id, clubName: id, formation: "4-3-3",
      tactics: { mentality: "BALANCED", pressing: "NORMAL", tempo: "NORMAL", passingStyle: "MIXED" },
      stadiumCapacity: 20_000, ticketPrice: 250n, reputation: 100, coachMedicalSkill: 0,
      players: Array.from({ length: 11 }, (_, index) => ({
        id: id + "-player-" + index, name: "Player " + index,
        position: index === 0 ? "GK" : index === 1 ? "CB" : "ST",
        overall: 70, morale: 80, fitness: 95,
        attributes: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70, goalkeeping: index === 0 ? 75 : 20 },
      })),
      bench: [],
    });
    const home = makeSide("home");
    const away = makeSide("away");
    const initial: MatchSegmentState = {
      currentMinute: 0, nextSequence: 1,
      home: { side: home, score: 0, expectedGoals: 0 },
      away: { side: away, score: 0, expectedGoals: 0 },
      events: [],
    };
    const substitutionsFor = (side: MatchSide): MatchSubstitutionState => ({
      onPitch: side.players.map(player => ({ id: player.id, position: player.position })),
      bench: [],
      substitutionsUsed: 0, inPlayWindowsUsed: 0, substitutedOutIds: [],
      sentOffIds: [], usedCheckpointIds: [],
    });
    let segment = initial;
    let homeSubstitutions = substitutionsFor(home);
    let awaySubstitutions = substitutionsFor(away);
    let substitutionErrors: string[] = [];
    for (const minute of [45, 60, 75, 90]) {
      const advanced = advanceMatchSegment({
        seed: "settlement-seed", state: segment, toMinute: minute,
        homeSubstitutions, awaySubstitutions, rules: defaultMatchRules("FRIENDLY"),
      });
      segment = advanced.state;
      homeSubstitutions = advanced.homeSubstitutions;
      awaySubstitutions = advanced.awaySubstitutions;
      substitutionErrors = [...substitutionErrors, ...advanced.substitutionErrors];
    }
    assert.equal(segment.currentMinute, 90);
    const simulationState = {
      segment,
      substitutions: { home: homeSubstitutions, away: awaySubstitutions },
      substitutionErrors,
    };
    const runtime = {
      id: "runtime-full-time", matchId: "match-full-time", status: "RUNNING",
      currentMinute: 90, stateVersion: 12, leaseToken: "lease-full-time",
      simulationState, startedAt: kickoffAt, fallbackPlan: null,
      kickoffSnapshot: { home, away },
      match: {
        id: "match-full-time", status: "IN_PROGRESS", seed: "settlement-seed",
        type: "FRIENDLY", rulesSnapshot: null, homeClubId: "home", awayClubId: "away",
        startedAt: kickoffAt, competitionId: null, round: null, leg: 1, tieId: null,
        competition: null, firstLeg: null,
      },
    };
    const settlementResult: MatchRuntimeSettlementResult = {
      matchId: "match-full-time", replayed: false, competitionId: null, round: null,
      homeClub: "Home", awayClub: "Away", homeScore: segment.home.score, awayScore: segment.away.score,
      homePenalties: null, awayPenalties: null, winnerClubId: null,
      attendance: 0, ticketRevenue: "0", events: [],
      advancement: null, pyramidFinalization: null, eventTournamentFinalization: null,
    };
    const result = await withMatchRuntimeLeasePort({
      async claim(input) {
        calls.push("claim");
        assert.equal(input.now, now.toISOString());
        return [{ runtime: { id: "runtime-full-time" }, lease: {
          owner: input.workerId, token: "lease-full-time", expiresAt: new Date(now.getTime() + 60_000),
        } }];
      },
      async release() {
        calls.push("unexpected-release");
        return true;
      },
    }, () => withMatchRuntimeSnapshotPort({
      async get(runtimeId) {
        calls.push("snapshot");
        assert.equal(runtimeId, "runtime-full-time");
        return runtime;
      },
    }, () => withMatchRuntimeSettlementPort({
      async settle(input) {
        calls.push("settle");
        assert.equal(input.matchId, "match-full-time");
        assert.equal(input.runtimeId, "runtime-full-time");
        assert.equal(input.leaseToken, "lease-full-time");
        assert.equal(input.now, now.toISOString());
        const finalResult = input.result as {
          homeScore: number; awayScore: number;
          events: Array<Record<string, unknown>>;
          performances: Array<{ playerId: string; minutesPlayed: number }>;
          injuredPlayerIds: string[]; yellowCardPlayerIds: string[]; redCardPlayerIds: string[];
        };
        assert.equal(finalResult.homeScore, segment.home.score);
        assert.equal(finalResult.awayScore, segment.away.score);
        assert.deepEqual(finalResult.events, segment.events.map(event => ({
          sequence: event.sequence, minute: event.minute, type: event.type, teamId: event.teamId,
          playerId: event.playerId, relatedPlayerId: event.relatedPlayerId ?? null, detail: event.detail,
        })));
        assert.equal(finalResult.performances.length, 22);
        assert.ok(finalResult.performances.every(line => line.playerId && line.minutesPlayed >= 0));
        assert.ok(Array.isArray(finalResult.injuredPlayerIds));
        assert.ok(Array.isArray(finalResult.yellowCardPlayerIds));
        assert.ok(Array.isArray(finalResult.redCardPlayerIds));
        assert.equal(input.homeReward, "150");
        assert.equal(input.awayReward, "150");
        assert.equal(input.injuryDurationDays, defaultMatchRules("FRIENDLY").injuryDurationDays);
        return settlementResult;
      },
    }, () => processDueMatchRuntimes("settlement-worker", now, 1, { enqueue: false }))));

    assert.deepEqual(calls, ["claim", "snapshot", "settle"]);
    assert.deepEqual(result, { enqueued: 0, claimed: 1, advanced: 0, waiting: 0, settled: 1, failed: 0 });
  });
});


test("match worker releases its lease with the RPC error when Supabase full-time settlement fails", async () => {
  await withTestEnvironment(async () => {
    const calls: string[] = [];
    const now = new Date("2026-11-20T14:00:00.000Z");
    const kickoffAt = new Date(now.getTime() - 90_000);
    const makeSide = (id: string): MatchSide => ({
      clubId: id, clubName: id, formation: "4-3-3",
      tactics: { mentality: "BALANCED", pressing: "NORMAL", tempo: "NORMAL", passingStyle: "MIXED" },
      stadiumCapacity: 20_000, ticketPrice: 250n, reputation: 100, coachMedicalSkill: 0,
      players: Array.from({ length: 11 }, (_, index) => ({
        id: id + "-player-" + index, name: "Player " + index,
        position: index === 0 ? "GK" : index === 1 ? "CB" : "ST",
        overall: 70, morale: 80, fitness: 95,
        attributes: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70, goalkeeping: index === 0 ? 75 : 20 },
      })),
      bench: [],
    });
    const home = makeSide("home");
    const away = makeSide("away");
    const initial: MatchSegmentState = {
      currentMinute: 0, nextSequence: 1,
      home: { side: home, score: 0, expectedGoals: 0 },
      away: { side: away, score: 0, expectedGoals: 0 },
      events: [],
    };
    const substitutionsFor = (side: MatchSide): MatchSubstitutionState => ({
      onPitch: side.players.map(player => ({ id: player.id, position: player.position })),
      bench: [],
      substitutionsUsed: 0, inPlayWindowsUsed: 0, substitutedOutIds: [],
      sentOffIds: [], usedCheckpointIds: [],
    });
    let segment = initial;
    let homeSubstitutions = substitutionsFor(home);
    let awaySubstitutions = substitutionsFor(away);
    let substitutionErrors: string[] = [];
    for (const minute of [45, 60, 75, 90]) {
      const advanced = advanceMatchSegment({
        seed: "settlement-seed", state: segment, toMinute: minute,
        homeSubstitutions, awaySubstitutions, rules: defaultMatchRules("FRIENDLY"),
      });
      segment = advanced.state;
      homeSubstitutions = advanced.homeSubstitutions;
      awaySubstitutions = advanced.awaySubstitutions;
      substitutionErrors = [...substitutionErrors, ...advanced.substitutionErrors];
    }
    assert.equal(segment.currentMinute, 90);
    const simulationState = {
      segment,
      substitutions: { home: homeSubstitutions, away: awaySubstitutions },
      substitutionErrors,
    };
    const runtime = {
      id: "runtime-full-time", matchId: "match-full-time", status: "RUNNING",
      currentMinute: 90, stateVersion: 12, leaseToken: "lease-full-time",
      simulationState, startedAt: kickoffAt, fallbackPlan: null,
      kickoffSnapshot: { home, away },
      match: {
        id: "match-full-time", status: "IN_PROGRESS", seed: "settlement-seed",
        type: "FRIENDLY", rulesSnapshot: null, homeClubId: "home", awayClubId: "away",
        startedAt: kickoffAt, competitionId: null, round: null, leg: 1, tieId: null,
        competition: null, firstLeg: null,
      },
    };
    const settlementResult: MatchRuntimeSettlementResult = {
      matchId: "match-full-time", replayed: false, competitionId: null, round: null,
      homeClub: "Home", awayClub: "Away", homeScore: segment.home.score, awayScore: segment.away.score,
      homePenalties: null, awayPenalties: null, winnerClubId: null,
      attendance: 0, ticketRevenue: "0", events: [],
      advancement: null, pyramidFinalization: null, eventTournamentFinalization: null,
    };
    const result = await withMatchRuntimeLeasePort({
      async claim(input) {
        calls.push("claim");
        assert.equal(input.now, now.toISOString());
        return [{ runtime: { id: "runtime-full-time" }, lease: {
          owner: input.workerId, token: "lease-full-time", expiresAt: new Date(now.getTime() + 60_000),
        } }];
      },
      async release(input) {
        calls.push("release");
        assert.equal(input.runtimeId, "runtime-full-time");
        assert.equal(input.leaseToken, "lease-full-time");
        assert.equal(input.nextActionAt, new Date(now.getTime() + 10_000).toISOString());
        assert.equal(input.lastError, "MATCH_RUNTIME_SETTLEMENT_TEMPORARY_FAILURE");
        return true;
      },
    }, () => withMatchRuntimeSnapshotPort({
      async get(runtimeId) {
        calls.push("snapshot");
        assert.equal(runtimeId, "runtime-full-time");
        return runtime;
      },
    }, () => withMatchRuntimeSettlementPort({
      async settle(input) {
        calls.push("settle");
        assert.equal(input.matchId, "match-full-time");
        assert.equal(input.runtimeId, "runtime-full-time");
        assert.equal(input.leaseToken, "lease-full-time");
        throw new Error("MATCH_RUNTIME_SETTLEMENT_TEMPORARY_FAILURE");
      },
    }, () => processDueMatchRuntimes("settlement-worker", now, 1, { enqueue: false }))));

    assert.deepEqual(calls, ["claim", "snapshot", "settle", "release"]);
    assert.deepEqual(result, { enqueued: 0, claimed: 1, advanced: 0, waiting: 0, settled: 0, failed: 1 });
  });
});
