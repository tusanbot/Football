import type { ClubManagementAction, ClubManagementPort } from "./club-management-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";
export class SupabaseClubManagementRepository implements ClubManagementPort {
 constructor(private readonly client: SupabaseHttpClient) {}
 async getAcademyLevel(userId: string): Promise<number> {
  const rows = await this.client.select<Array<{ academyLevel: number }>>("Club", {
   select: "academyLevel", ownerId: "eq." + userId, limit: "1",
  });
  if (!Array.isArray(rows) || !rows[0] || !Number.isInteger(rows[0].academyLevel)) throw new Error("CLUB_NOT_FOUND");
  return rows[0].academyLevel;
 }
 async execute(action: ClubManagementAction, userId: string, idempotencyKey: string, payload: Record<string, unknown>, now: Date): Promise<unknown> {
  return this.client.rpc("club_management_command", { p_action: action, p_user_id: userId, p_idempotency_key: idempotencyKey, p_payload: payload, p_now: now.toISOString() });
 }
}
