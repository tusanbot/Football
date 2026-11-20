import { describe, expect, it, vi } from "vitest";
import { NodeSupabaseAdminBroadcastManagementRepository } from "../src/node-supabase-admin-broadcast-management.js";
import type { SupabaseHttpClient } from "../src/node-supabase-http.js";
describe("NodeSupabaseAdminBroadcastManagementRepository",()=>{
 it("retries failed group broadcasts through an idempotent RPC",async()=>{
  const rpc=vi.fn().mockResolvedValue({ok:true,retried:3,replayed:false});
  const repo=new NodeSupabaseAdminBroadcastManagementRepository({rpc} as unknown as SupabaseHttpClient);
  await expect(repo.retry("groups","broadcast-1","123456","broadcast-retry-key1")).resolves.toEqual({retried:3,replayed:false});
  expect(rpc).toHaveBeenCalledWith("admin_broadcast_retry_http",expect.objectContaining({p_kind:"groups",p_target_id:"broadcast-1"}));
 });
 it("rejects malformed responses",async()=>{
  const repo=new NodeSupabaseAdminBroadcastManagementRepository({rpc:vi.fn().mockResolvedValue({ok:false})} as unknown as SupabaseHttpClient);
  await expect(repo.retry("users","broadcast-1","123456","broadcast-retry-key2")).rejects.toThrow("SUPABASE_ADMIN_BROADCAST_RETRY_INVALID_RESPONSE");
 });
});
