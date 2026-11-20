import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseAdminSeasonAwardActionsRepository } from "../src/repositories/admin-season-awards.js";
function repository(response: unknown) {
 const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
 const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return response; } } as never;
 return { repo: new SupabaseAdminSeasonAwardActionsRepository(client), calls };
}
test("Worker season award adapter uses the shared RPC contract", async () => {
 const { repo, calls } = repository({ ok: true, targetType: "season-player-award", targetId: "award-1", replay: false });
 await repo.execute({ action: "set-season-player-award", season: 2042, playerId: "player-1", awardType: "PLAYER_OF_SEASON", awardName: "Best Player", actorTelegramId: "910000001", idempotencyKey: "season-award-set-01" });
 assert.equal(calls[0]?.name, "admin_season_player_award_http");
 assert.equal(calls[0]?.args.p_player_id, "player-1");
});
test("Worker season award adapter rejects invalid responses", async () => {
 const { repo } = repository({});
 await assert.rejects(repo.execute({ action: "remove-season-player-award", targetId: "award-1", actorTelegramId: "910000001", idempotencyKey: "season-award-remove-01" }), /SUPABASE_ADMIN_SEASON_AWARD_INVALID_RESPONSE/);
});
