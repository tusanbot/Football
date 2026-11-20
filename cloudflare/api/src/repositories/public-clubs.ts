import type { PublicClubReadRepository, PublicClubRecord, PublicClubProfile, PublicClubComparison } from "../../../../apps/api/src/public-club-routes.js";
import type { PublicClubLogoRepository } from "../../../../apps/api/src/node-supabase-public-club-logo.js";
import { SupabaseHttpClient } from "../supabase-http.js";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PUBLIC_CLUB_RESPONSE");
  return value as Record<string, unknown>;
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("INVALID_PUBLIC_CLUB_RESPONSE");
  return value;
}
function club(value: unknown): PublicClubRecord {
  const row = record(value);
  if (typeof row.id !== "string" || typeof row.name !== "string" || !Number.isInteger(row.level)
    || !Number.isInteger(row.reputation) || !(row.logoMime === null || typeof row.logoMime === "string")) {
    throw new Error("INVALID_PUBLIC_CLUB_RECORD");
  }
  return {
    id: row.id, name: row.name, level: row.level as number, reputation: row.reputation as number,
    logoMime: row.logoMime as string | null,
    pyramidLeagueEntries: rows(row.pyramidLeagueEntries) as PublicClubRecord["pyramidLeagueEntries"],
  };
}

export class SupabasePublicClubRepository implements PublicClubReadRepository {
  constructor(private readonly client: SupabaseHttpClient) {}
  async list(query: string | null): Promise<PublicClubRecord[]> {
    const result = record(await this.client.rpc("get_public_clubs_http", { p_query: query, p_limit: 100 }));
    return rows(result.clubs).map(club);
  }
  async profile(clubId: string): Promise<PublicClubProfile | null> {
    const result = await this.client.rpc("get_public_club_profile_http", { p_club_id: clubId });
    if (result === null) return null;
    const row = record(result);
    const base = club(row);
    if (typeof row.slug !== "string" || typeof row.createdAt !== "string") throw new Error("INVALID_PUBLIC_CLUB_PROFILE");
    return { ...base, slug: row.slug, createdAt: row.createdAt };
  }
  async compare(first: string, second: string): Promise<PublicClubComparison | null> {
    const result = record(await this.client.rpc("compare_public_clubs_http", { p_first: first, p_second: second }));
    if (result.clubs === null) return null;
    const clubs = rows(result.clubs).map((value) => {
      const row = record(value);
      if (typeof row.id !== "string" || typeof row.name !== "string" || !Number.isInteger(row.level)
        || !Number.isInteger(row.reputation) || !(row.logoMime === null || typeof row.logoMime === "string")) {
        throw new Error("INVALID_PUBLIC_CLUB_COMPARISON");
      }
      return { id: row.id, name: row.name, level: row.level as number, reputation: row.reputation as number, logoMime: row.logoMime as string | null };
    });
    if (clubs.length !== 2) throw new Error("INVALID_PUBLIC_CLUB_COMPARISON");
    return { clubs, matches: rows(result.matches) as PublicClubComparison["matches"] };
  }
}

export class SupabasePublicClubLogoRepository implements PublicClubLogoRepository {
  constructor(private readonly client: SupabaseHttpClient) {}
  async getLogo(clubId: string) {
    const result = await this.client.select<Array<{ logoData: string | null; logoMime: string | null }>>("Club", {
      select: "logoData,logoMime", id: "eq." + clubId, limit: "1",
    });
    return result[0] ?? null;
  }
  async manageLogo(userId: string, action: "upload" | "delete", logoData?: string, logoMime?: string) {
    const result = await this.client.rpc<Awaited<ReturnType<PublicClubLogoRepository["manageLogo"]>>>("manage_club_logo_http", {
      p_user_id: userId, p_action: action, p_logo_data: logoData ?? null, p_logo_mime: logoMime ?? null,
    });
    if (!result || typeof result !== "object" || !("kind" in result)) throw new Error("INVALID_CLUB_LOGO_RESPONSE");
    return result;
  }
}
