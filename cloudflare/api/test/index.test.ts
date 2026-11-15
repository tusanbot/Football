import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const unusedDb = {
  prepare() {
    return {
      bind() { return this; },
      async first() { return null; },
    };
  },
};

test("health endpoint identifies the migration scaffold", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/health"), { DB: unusedDb });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "football-empire-cloudflare-api",
    mode: "migration-scaffold",
  });
});

test("readiness stays closed even after the bootstrap migration", async () => {
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async first() { return { version: "0001_platform_bootstrap" }; },
      };
    },
  };
  const response = await worker.fetch(new Request("https://api.example.test/ready"), { DB: db });
  assert.equal(response.status, 503);
  const body = await response.json() as { status: string; missing: string[]; database: { available: boolean } };
  assert.equal(body.status, "not_ready");
  assert.equal(body.database.available, true);
  assert.ok(body.missing.includes("GAME_SCHEMA_MIGRATION"));
  assert.ok(body.missing.includes("D1_ATOMIC_REPOSITORY"));
});

test("game routes fail closed until migration gates pass", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/v1/me"), { DB: unusedDb });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { error: string }).error, "GAME_API_MIGRATION_INCOMPLETE");
});


test("readiness recognizes the generated game schema migration", async () => {
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async first() { return { version: "0002_game_schema" }; },
      };
    },
  };
  const response = await worker.fetch(new Request("https://api.example.test/ready"), { DB: db });
  assert.equal(response.status, 503);
  const body = await response.json() as { missing: string[]; database: { migrationVersion: string } };
  assert.equal(body.database.migrationVersion, "0002_game_schema");
  assert.ok(!body.missing.includes("GAME_SCHEMA_MIGRATION"));
  assert.ok(body.missing.includes("D1_ATOMIC_REPOSITORY"));
});
