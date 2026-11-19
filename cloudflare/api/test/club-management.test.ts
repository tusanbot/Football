import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseClubManagementRepository } from "../src/repositories/club-management.js";
test("club management repository forwards a typed command to the atomic RPC", async () => {
 let call: unknown;
 const repo = new SupabaseClubManagementRepository({ rpc: async (name: string, args: unknown) => { call={name,args}; return {ok:true}; } } as never);
 const now=new Date("2026-11-19T10:00:00.000Z");
 const result=await repo.execute("UPGRADE_FACILITY","user-1","request-key-1234",{facility:"STADIUM"},now);
 assert.deepEqual(call,{name:"club_management_command",args:{p_action:"UPGRADE_FACILITY",p_user_id:"user-1",p_idempotency_key:"request-key-1234",p_payload:{facility:"STADIUM"},p_now:now.toISOString()}});
 assert.deepEqual(result,{ok:true});
});
