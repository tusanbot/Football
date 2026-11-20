import assert from "node:assert/strict";
import test from "node:test";
import { getEventTournamentSettlementPort } from "../src/event-tournament-settlement-context.js";
import { getTelegramAccountProvisioningPort } from "../src/auth/account-provisioning-context.js";
import { getMatchRuntimeEnqueuePort } from "../src/game/match-runtime-enqueue-context.js";
import { getMatchRuntimeForfeitPort } from "../src/game/match-runtime-forfeit-context.js";
import { getMatchRuntimeLeasePort } from "../src/game/match-runtime-lease-context.js";

test("production match and tournament workers fail closed without Supabase ports", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnvironment = process.env.ENVIRONMENT;
  process.env.NODE_ENV = "production";
  delete process.env.ENVIRONMENT;
  try {
    assert.throws(() => getMatchRuntimeLeasePort(), /MATCH_RUNTIME_LEASE_SUPABASE_REPOSITORY_REQUIRED/);
    assert.throws(() => getMatchRuntimeEnqueuePort(), /MATCH_RUNTIME_ENQUEUE_SUPABASE_REPOSITORY_REQUIRED/);
    assert.throws(() => getMatchRuntimeForfeitPort(), /MATCH_RUNTIME_FORFEIT_SUPABASE_REPOSITORY_REQUIRED/);
    assert.throws(() => getEventTournamentSettlementPort(), /EVENT_TOURNAMENT_SETTLEMENT_SUPABASE_REPOSITORY_REQUIRED/);
    assert.throws(() => getTelegramAccountProvisioningPort(), /TELEGRAM_ACCOUNT_PROVISIONING_SUPABASE_REPOSITORY_REQUIRED/);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
  }
});
