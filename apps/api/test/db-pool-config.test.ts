import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolConfig } from "../src/db.js";

test("Supabase transaction pooler connections always use verified TLS", () => {
  const config = createPgPoolConfig(
    "postgresql://user:secret@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?sslmode=disable&ssl=false",
    1,
  );
  const parsed = new URL(String(config.connectionString));

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(parsed.searchParams.get("pgbouncer"), "true");
  assert.equal(parsed.searchParams.has("sslmode"), false);
  assert.equal(parsed.searchParams.has("ssl"), false);
  assert.equal(config.max, 1);
});

test("non-pooler development connections retain their configured transport", () => {
  const config = createPgPoolConfig("postgresql://user:secret@127.0.0.1:5432/football", 2);
  assert.equal(config.ssl, undefined);
  assert.equal(config.max, 2);
});
