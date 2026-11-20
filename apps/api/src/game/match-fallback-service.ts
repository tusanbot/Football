import { SupabaseHttpClient } from "../node-supabase-http.js";

export type MatchFallbackPlan = {
  formation: string;
  mentality: "DEFENSIVE" | "BALANCED" | "ATTACKING";
  pressing: "LOW_BLOCK" | "MID_BLOCK" | "HIGH_PRESS";
  tempo: "SLOW" | "NORMAL" | "FAST";
  passingStyle: "SHORT" | "MIXED" | "DIRECT";
};

export class MatchFallbackPlanError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MatchFallbackPlanError";
  }
}

type ClubFallbackRow = {
  id: string;
  formation: string;
  mentality: string;
  pressing: string;
  tempo: string;
  passingStyle: string;
  matchFallbackPlan: unknown | null;
  matchFallbackPlanVersion: number;
};

const allowedFormations = ["4-3-3", "4-4-2", "3-5-2", "4-2-3-1"];
const allowedMentalities = ["DEFENSIVE", "BALANCED", "ATTACKING"];
const allowedPressing = ["LOW_BLOCK", "MID_BLOCK", "HIGH_PRESS"];
const allowedTempos = ["SLOW", "NORMAL", "FAST"];
const allowedPassingStyles = ["SHORT", "MIXED", "DIRECT"];

function client(): SupabaseHttpClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_HTTP_CONFIGURATION_REQUIRED");
  return new SupabaseHttpClient({ url, serviceRoleKey: key });
}

const defaultPlan = (club: Pick<ClubFallbackRow, "formation" | "mentality" | "pressing" | "tempo" | "passingStyle">): MatchFallbackPlan => ({
  formation: club.formation,
  mentality: club.mentality as MatchFallbackPlan["mentality"],
  pressing: club.pressing as MatchFallbackPlan["pressing"],
  tempo: club.tempo as MatchFallbackPlan["tempo"],
  passingStyle: club.passingStyle as MatchFallbackPlan["passingStyle"],
});

function parseStoredPlan(value: unknown, fallback: MatchFallbackPlan): MatchFallbackPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const item = value as Record<string, unknown>;
  const valid = allowedFormations.includes(String(item.formation))
    && allowedMentalities.includes(String(item.mentality))
    && allowedPressing.includes(String(item.pressing))
    && allowedTempos.includes(String(item.tempo))
    && allowedPassingStyles.includes(String(item.passingStyle));
  if (!valid) return fallback;
  return {
    formation: String(item.formation),
    mentality: String(item.mentality) as MatchFallbackPlan["mentality"],
    pressing: String(item.pressing) as MatchFallbackPlan["pressing"],
    tempo: String(item.tempo) as MatchFallbackPlan["tempo"],
    passingStyle: String(item.passingStyle) as MatchFallbackPlan["passingStyle"],
  };
}

async function loadClub(userId: string, select: string): Promise<ClubFallbackRow | null> {
  const rows = await client().select<ClubFallbackRow[]>("Club", {
    select, ownerId: "eq." + userId, limit: "1",
  });
  return rows[0] ?? null;
}

export async function getMatchFallbackPlan(userId: string) {
  const club = await loadClub(userId, "id,formation,mentality,pressing,tempo,passingStyle,matchFallbackPlan,matchFallbackPlanVersion");
  if (!club) throw new MatchFallbackPlanError("CLUB_NOT_FOUND");
  const fallback = defaultPlan(club);
  return {
    plan: parseStoredPlan(club.matchFallbackPlan, fallback),
    version: club.matchFallbackPlanVersion,
    isCustom: club.matchFallbackPlan !== null,
  };
}

export async function saveMatchFallbackPlan(userId: string, plan: MatchFallbackPlan, expectedVersion: number) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new MatchFallbackPlanError("INVALID_FALLBACK_PLAN_VERSION");
  }
  const club = await loadClub(userId, "id,matchFallbackPlanVersion");
  if (!club) throw new MatchFallbackPlanError("CLUB_NOT_FOUND");
  const updated = await client().update<ClubFallbackRow[]>("Club", {
    id: "eq." + club.id,
    ownerId: "eq." + userId,
    matchFallbackPlanVersion: "eq." + expectedVersion,
  }, {
    matchFallbackPlan: plan,
    matchFallbackPlanVersion: expectedVersion + 1,
  });
  if (!Array.isArray(updated) || updated.length !== 1) {
    throw new MatchFallbackPlanError("FALLBACK_PLAN_VERSION_CONFLICT");
  }
  return { plan, version: expectedVersion + 1, isCustom: true };
}
