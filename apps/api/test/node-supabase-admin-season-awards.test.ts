import assert from "node:assert/strict";
import test from "node:test";
import { NodeSupabaseAdminSeasonAwardActionsRepository } from "../src/node-supabase-admin-season-awards.js";
function repository(response: unknown) {
 const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
 const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return response; } } as never;
 return { repo: new NodeSupabaseAdminSeasonAwardActionsRepository(client), calls };
}
test("season award set and remove use atomic idempotent RPC", async () => {
 const { repo, calls } = repository({ ok: true, targetType: "season-player-award", targetId: "award-1", replay: false });
 assert.deepEqual(await repo.execute({ action: "set-season-player-award", season: 2042, playerId: "player-1", awardType: "PLAYER_OF_SEASON", awardName: "Best Player", actorTelegramId: "910000001", idempotencyKey: "season-award-set-01" }), { ok: true, targetType: "season-player-award", targetId: "award-1", replay: false });
 assert.equal(calls[0]?.name, "admin_season_player_award_http");
 assert.equal(calls[0]?.args.p_action, "set-season-player-award");
 assert.equal(calls[0]?.args.p_season, 2042);
 const remove = repository({ ok: true, targetType: "season-player-award", targetId: "award-1", replay: true });
 assert.equal((await remove.repo.execute({ action: "remove-season-player-award", targetId: "award-1", actorTelegramId: "910000001", idempotencyKey: "season-award-remove-01" })).replay, true);
 assert.equal(remove.calls[0]?.args.p_target_id, "award-1");
});
test("season award adapter rejects invalid inputs and malformed RPC responses", async () => {
 const invalid = repository({});
 await assert.rejects(invalid.repo.execute({ action: "set-season-player-award", season: 1900, playerId: "p", awardType: "NOPE", awardName: "x", actorTelegramId: "bad", idempotencyKey: "short" }), /INVALID_SEASON_AWARD_ACTION/);
 const malformed = repository({ ok: true });
 await assert.rejects(malformed.repo.execute({ action: "remove-season-player-award", targetId: "award-1", actorTelegramId: "910000001", idempotencyKey: "season-award-remove-02" }), /SUPABASE_ADMIN_SEASON_AWARD_INVALID_RESPONSE/);
});
