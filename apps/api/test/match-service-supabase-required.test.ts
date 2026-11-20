import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { MatchServiceError, processDueMatchRuntimes } from "../src/game/match-service.js";
import { getMatchOpponentPort } from "../src/game/match-opponents-context.js";
import { getFriendlyMatchCreationPort } from "../src/game/friendly-match-creation-context.js";
import { getCompetitionCreationPort } from "../src/game/competition-creation-context.js";
import { getCompetitionReadPort } from "../src/game/competition-read-context.js";
import { getClubMatchReadPort } from "../src/game/club-match-read-context.js";
import { getCompetitionAdvancementPort } from "../src/game/competition-advancement-context.js";
import { withMatchRuntimeSnapshotPort } from "../src/game/match-runtime-snapshot-context.js";
import { withMatchRuntimeLeasePort } from "../src/game/match-runtime-lease-context.js";
import { withMatchRuntimeEnqueuePort } from "../src/game/match-runtime-enqueue-context.js";
import { withMatchRuntimeForfeitPort } from "../src/game/match-runtime-forfeit-context.js";
import { withMatchRuntimeAdvancePort } from "../src/game/match-runtime-advance-context.js";
import { withMatchRuntimeCheckpointPort } from "../src/game/match-runtime-checkpoint-context.js";
import { withMatchRuntimeSettlementPort } from "../src/game/match-runtime-settlement-context.js";
import { withCompetitionAdvancementPort } from "../src/game/competition-advancement-context.js";
import { withPyramidLeagueSettlementPort } from "../src/game/pyramid-league-settlement-context.js";

test("production API refuses to start without direct Supabase match repositories", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(
      () => buildApp(),
      /SUPABASE_MATCH_PORTS_REQUIRED/,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("production API refuses to start without a Supabase readiness client", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(
      () => buildApp({ matchPorts: {} as never }),
      /SUPABASE_MATCH_PORTS_REQUIRED/,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("production match worker refuses to use Prisma when Supabase runtime ports are absent", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnvironment = process.env.ENVIRONMENT;
  process.env.NODE_ENV = "test";
  process.env.ENVIRONMENT = "production";
  try {
    await assert.rejects(
      processDueMatchRuntimes(),
      (error: unknown) => error instanceof MatchServiceError
        && error.code === "WORKER_MATCH_RUNTIME_REPOSITORY_SET_INCOMPLETE",
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
  }
});

test("production match service scopes fail closed when any request-scoped Supabase repository is missing", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const requiredRepositories = [
      [getMatchOpponentPort, "MATCH_OPPONENT_SUPABASE_REPOSITORY_REQUIRED"],
      [getFriendlyMatchCreationPort, "FRIENDLY_MATCH_SUPABASE_REPOSITORY_REQUIRED"],
      [getCompetitionCreationPort, "COMPETITION_SUPABASE_REPOSITORY_REQUIRED"],
      [getCompetitionReadPort, "COMPETITION_READ_SUPABASE_REPOSITORY_REQUIRED"],
      [getClubMatchReadPort, "CLUB_MATCH_READ_SUPABASE_REPOSITORY_REQUIRED"],
      [getCompetitionAdvancementPort, "COMPETITION_ADVANCEMENT_SUPABASE_REPOSITORY_REQUIRED"],
    ] as const;

    for (const [getRepository, expectedCode] of requiredRepositories) {
      assert.throws(
        () => getRepository(),
        (error: unknown) => error instanceof Error && error.message === expectedCode,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});


test("production match worker refuses to start without event tournament settlement repository", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnvironment = process.env.ENVIRONMENT;
  process.env.NODE_ENV = "production";
  delete process.env.ENVIRONMENT;
  const emptyPort = {} as never;
  try {
    await assert.rejects(
      withMatchRuntimeSnapshotPort(emptyPort, () =>
        withMatchRuntimeLeasePort(emptyPort, () =>
          withMatchRuntimeEnqueuePort(emptyPort, () =>
            withMatchRuntimeForfeitPort(emptyPort, () =>
              withMatchRuntimeAdvancePort(emptyPort, () =>
                withMatchRuntimeCheckpointPort(emptyPort, () =>
                  withMatchRuntimeSettlementPort(emptyPort, () =>
                    withCompetitionAdvancementPort(emptyPort, () =>
                      withPyramidLeagueSettlementPort(emptyPort, () => processDueMatchRuntimes()),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      (error: unknown) => error instanceof MatchServiceError
        && error.code === "WORKER_MATCH_RUNTIME_REPOSITORY_SET_INCOMPLETE",
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
  }
});
