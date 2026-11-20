import { SupabaseHttpClient } from "./node-supabase-http.js";
export type AdminSeasonAwardAction = "set-season-player-award" | "remove-season-player-award";
export interface AdminSeasonAwardActionInput {
 action: AdminSeasonAwardAction; actorTelegramId: string; idempotencyKey: string;
 targetId?: string; season?: number; playerId?: string; awardType?: string; awardName?: string; reason?: string;
}
export interface AdminSeasonAwardActionPort {
 execute(input: AdminSeasonAwardActionInput): Promise<{ ok: true; targetType: string; targetId: string; replay: boolean }>;
}
export class NodeSupabaseAdminSeasonAwardActionsRepository implements AdminSeasonAwardActionPort {
 constructor(private readonly client: SupabaseHttpClient) {}
 async execute(input: AdminSeasonAwardActionInput) {
  if (!["set-season-player-award","remove-season-player-award"].includes(input.action)
   || !/^[0-9]{1,20}$/.test(input.actorTelegramId) || !/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotencyKey)
   || (input.reason !== undefined && input.reason.length > 500)
   || (input.action === "set-season-player-award" && (!Number.isInteger(input.season) || input.season! < 2020 || input.season! > 2200
    || !input.playerId || input.playerId.length > 128 || !["TOP_SCORER","TOP_ASSISTS","PLAYER_OF_SEASON","TEAM_OF_SEASON","FAIR_PLAY","MOST_IMPROVED"].includes(input.awardType ?? "")
    || !input.awardName || input.awardName.trim().length < 2 || input.awardName.trim().length > 80 || input.targetId !== undefined))
   || (input.action === "remove-season-player-award" && (!input.targetId || input.targetId.length > 128
    || input.season !== undefined || input.playerId !== undefined || input.awardType !== undefined || input.awardName !== undefined))) {
   throw new Error("INVALID_SEASON_AWARD_ACTION");
  }
  const result = await this.client.rpc<Record<string, unknown>>("admin_season_player_award_http", {
   p_action: input.action, p_target_id: input.targetId ?? null, p_season: input.season ?? null,
   p_player_id: input.playerId ?? null, p_award_type: input.awardType ?? null, p_award_name: input.awardName ?? null,
   p_reason: input.reason ?? null, p_actor_telegram_id: input.actorTelegramId, p_idempotency_key: input.idempotencyKey,
  });
  if (!result || result.ok !== true || result.targetType !== "season-player-award" || typeof result.targetId !== "string" || typeof result.replay !== "boolean") {
   throw new Error("SUPABASE_ADMIN_SEASON_AWARD_INVALID_RESPONSE");
  }
  return result as unknown as { ok: true; targetType: string; targetId: string; replay: boolean };
 }
}
