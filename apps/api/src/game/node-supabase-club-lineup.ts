import type { ClubLineupPort, ClubLineupUpdate } from "./club-lineup-context.js";
import { SupabaseHttpClient } from "../node-supabase-http.js";
type ClubRow = { id: string; name: string; formation: string; mentality: string; pressing: string; tempo: string; passingStyle: string; lineupVersion: number };
type PlayerRow = { id: string; firstName: string; lastName: string; position: string; overall: number; morale: number; fitness: number; lineupSlot: number | null; suspensionMatchesRemaining: number };
type SquadPlayerRow = { id: string; firstName: string; lastName: string; nationality: string; age: number; position: string; overall: number; potential: number; marketValue: string | number; attributes: unknown; wage: string | number; contractDays: number; morale: number; fitness: number; origin: string; status: string; lineupSlot: number | null; suspensionMatchesRemaining: number };
export class SupabaseClubLineupRepository implements ClubLineupPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async get(userId: string): Promise<unknown> {
    const clubs = await this.client.select<ClubRow[]>("Club", {
      select: "id,name,formation,mentality,pressing,tempo,passingStyle,lineupVersion", ownerId: "eq." + userId, limit: "1",
    });
    const club = clubs[0];
    if (!club) throw new Error("CLUB_NOT_FOUND");
    const players = await this.client.select<PlayerRow[]>("Player", {
      select: "id,firstName,lastName,position,overall,morale,fitness,lineupSlot,suspensionMatchesRemaining",
      clubId: "eq." + club.id, lineupSlot: "not.is.null", status: "eq.ACTIVE", order: "lineupSlot.asc",
    });
    return { club: {
      id: club.id, name: club.name, formation: club.formation,
      tactics: { mentality: club.mentality, pressing: club.pressing, tempo: club.tempo, passingStyle: club.passingStyle },
      lineupVersion: club.lineupVersion, players,
    } };
  }
  async rename(userId: string, name: string) {
    const result = await this.client.rpc<{ kind: "UPDATED" | "NOT_FOUND" | "LOCKED"; club?: { id: string; name: string; level: number; reputation: number }; activeCompetition?: { id: string; name: string } }>(
      "rename_club_http", { p_user_id: userId, p_name: name },
    );
    if (result.kind === "UPDATED" && result.club) return { kind: "UPDATED" as const, club: result.club };
    if (result.kind === "LOCKED" && result.activeCompetition) return { kind: "LOCKED" as const, activeCompetition: result.activeCompetition };
    return { kind: "NOT_FOUND" as const };
  }
  async listPlayers(userId: string) {
    const clubs = await this.client.select<Array<{ id: string }>>("Club", { select: "id", ownerId: "eq." + userId, limit: "1" });
    const club = clubs[0];
    if (!club) throw new Error("CLUB_NOT_FOUND");
    const players = await this.client.select<SquadPlayerRow[]>("Player", {
      select: "id,firstName,lastName,nationality,age,position,overall,potential,marketValue,attributes,wage,contractDays,morale,fitness,origin,status,lineupSlot,suspensionMatchesRemaining",
      clubId: "eq." + club.id, status: "in.(ACTIVE,INJURED,CONTRACT_EXPIRED)", order: "status.asc,position.asc,overall.desc",
    });
    return { players: players.map(player => ({ ...player, marketValue: String(player.marketValue), wage: String(player.wage) })), count: players.length };
  }
  async update(userId: string, input: ClubLineupUpdate) {
    return this.client.rpc<{ ok: boolean; lineupVersion?: number; error?: string; currentVersion?: number }>(
      "update_club_lineup_http", {
        p_user_id: userId, p_formation: input.formation, p_player_ids: input.playerIds,
        p_expected_version: input.expectedVersion, p_tactics: input.tactics ?? {},
      },
    );
  }
}
