import type { ClubManagementAction, ClubManagementPort } from "../../../../apps/api/src/game/club-management-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";
export class SupabaseClubManagementRepository implements ClubManagementPort {
 constructor(private readonly client: SupabaseHttpClient) {}
 async execute(action: ClubManagementAction, userId: string, idempotencyKey: string, payload: Record<string, unknown>, now: Date): Promise<unknown> {
  return this.client.rpc("club_management_command", { p_action: action, p_user_id: userId, p_idempotency_key: idempotencyKey, p_payload: payload, p_now: now.toISOString() });
 }
}
