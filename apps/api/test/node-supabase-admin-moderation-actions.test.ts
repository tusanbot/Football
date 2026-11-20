import { describe, expect, it, vi } from "vitest";
import { NodeSupabaseAdminModerationActionsRepository } from "../src/node-supabase-admin-moderation-actions.js";
import type { SupabaseHttpClient } from "../src/node-supabase-http.js";
describe("NodeSupabaseAdminModerationActionsRepository",()=>{
 it("executes audited moderation actions through the service HTTP RPC",async()=>{
  const rpc=vi.fn().mockResolvedValue({ok:true,targetType:"user",targetId:"user-1",replay:false});
  const repo=new NodeSupabaseAdminModerationActionsRepository({rpc} as unknown as SupabaseHttpClient);
  await expect(repo.execute({action:"suspend-user",targetId:"user-1",actorTelegramId:"123456",idempotencyKey:"moderation-key-001"})).resolves.toMatchObject({ok:true,replay:false});
  expect(rpc).toHaveBeenCalledWith("admin_moderation_action_http",expect.objectContaining({p_action:"suspend-user",p_target_id:"user-1",p_actor_telegram_id:"123456"}));
 });
 it("rejects malformed RPC responses",async()=>{
  const repo=new NodeSupabaseAdminModerationActionsRepository({rpc:vi.fn().mockResolvedValue({ok:false})} as unknown as SupabaseHttpClient);
  await expect(repo.execute({action:"restore-user",targetId:"user-1",actorTelegramId:"123456",idempotencyKey:"moderation-key-002"})).rejects.toThrow("SUPABASE_ADMIN_MODERATION_INVALID_RESPONSE");
 });
});
