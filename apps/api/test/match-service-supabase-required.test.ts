import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { MatchServiceError, processDueMatchRuntimes } from "../src/game/match-service.js";

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
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      processDueMatchRuntimes(),
      (error: unknown) => error instanceof MatchServiceError
        && error.code === "WORKER_MATCH_RUNTIME_REPOSITORY_SET_INCOMPLETE",
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
