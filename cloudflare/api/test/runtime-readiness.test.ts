import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseRuntimeReadinessRepository } from "../src/repositories/runtime-readiness.js";

test("runtime readiness calls the dedicated read-only Supabase RPC", async () => {
  let rpcName = "";
  let args: unknown;
  const client = { rpc: async (name: string, values: unknown) => { rpcName = name; args = values; return true; } } as never;
  const repository = new SupabaseRuntimeReadinessRepository(client);
  assert.equal(await repository.check(), true);
  assert.equal(rpcName, "football_runtime_readiness");
  assert.deepEqual(args, {});
});

test("runtime readiness rejects malformed RPC responses", async () => {
  const repository = new SupabaseRuntimeReadinessRepository({ rpc: async () => [{ ready: true }] } as never);
  await assert.rejects(() => repository.check(), /SUPABASE_RUNTIME_READINESS_INVALID_RESPONSE/);
});
