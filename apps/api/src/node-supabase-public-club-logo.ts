import { SupabaseHttpClient } from "./node-supabase-http.js";

export interface PublicClubLogoRepository {
  getLogo(clubId: string): Promise<{ logoData: string | null; logoMime: string | null } | null>;
  manageLogo(userId: string, action: "upload" | "delete", logoData?: string, logoMime?: string): Promise<
    { kind: "UPDATED"; club?: { id: string; name: string }; removed?: boolean }
    | { kind: "NOT_FOUND" }
    | { kind: "LOCKED"; activeCompetition: { id: string; name: string } }
  >;
}

export class NodeSupabasePublicClubLogoRepository implements PublicClubLogoRepository {
  constructor(private readonly client: SupabaseHttpClient) {}

  async getLogo(clubId: string) {
    const rows = await this.client.select<Array<{ logoData: string | null; logoMime: string | null }>>("Club", {
      select: "logoData,logoMime", id: "eq." + clubId, limit: "1",
    });
    return rows[0] ?? null;
  }

  async manageLogo(userId: string, action: "upload" | "delete", logoData?: string, logoMime?: string) {
    const result = await this.client.rpc<Awaited<ReturnType<PublicClubLogoRepository["manageLogo"]>> extends infer T ? T : never>(
      "manage_club_logo_http", {
        p_user_id: userId,
        p_action: action,
        p_logo_data: logoData ?? null,
        p_logo_mime: logoMime ?? null,
      },
    );
    if (!result || typeof result !== "object" || !("kind" in result)) throw new Error("INVALID_CLUB_LOGO_RESPONSE");
    return result;
  }
}
