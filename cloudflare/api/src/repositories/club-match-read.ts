import type { ClubMatchReadPort } from "../../../../apps/api/src/game/club-match-read-context.js";
import { SupabaseHttpClient } from "../supabase-http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export class SupabaseClubMatchReadRepository implements ClubMatchReadPort {
  constructor(private readonly client: SupabaseHttpClient) {}
  async list(userId: string) {
    const result = await this.client.rpc<Awaited<ReturnType<ClubMatchReadPort["list"]>>>("list_club_matches_http", { p_user_id: userId });
    if (!isRecord(result) || typeof result.clubId !== "string" || !Array.isArray(result.matches) || !Array.isArray(result.competitions)
      || result.matches.some((match) => !isRecord(match) || typeof match.id !== "string" || typeof match.type !== "string"
        || typeof match.status !== "string" || typeof match.scheduledAt !== "string" || !Number.isFinite(Date.parse(match.scheduledAt))
        || !isRecord(match.homeClub) || typeof match.homeClub.id !== "string" || typeof match.homeClub.name !== "string"
        || !isRecord(match.awayClub) || typeof match.awayClub.id !== "string" || typeof match.awayClub.name !== "string"
        || !Array.isArray(match.checkpoints) || !Array.isArray(match.events))
      || result.competitions.some((item) => !isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string"
        || !Number.isInteger(item.season) || typeof item.format !== "string" || !Number.isInteger(item.cupLegs) || typeof item.status !== "string")) {
      throw new Error("SUPABASE_CLUB_MATCH_READ_INVALID_RESPONSE");
    }
    return result;
  }
}
