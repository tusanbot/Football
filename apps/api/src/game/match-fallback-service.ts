import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

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

const defaultPlan = (club: {
  formation: string;
  mentality: string;
  pressing: string;
  tempo: string;
  passingStyle: string;
}): MatchFallbackPlan => ({
  formation: club.formation,
  mentality: club.mentality as MatchFallbackPlan["mentality"],
  pressing: club.pressing as MatchFallbackPlan["pressing"],
  tempo: club.tempo as MatchFallbackPlan["tempo"],
  passingStyle: club.passingStyle as MatchFallbackPlan["passingStyle"],
});

function parseStoredPlan(value: Prisma.JsonValue | null, fallback: MatchFallbackPlan): MatchFallbackPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const item = value as Record<string, Prisma.JsonValue>;
  const allowedFormation = ["4-3-3", "4-4-2", "3-5-2", "4-2-3-1"];
  const valid = allowedFormation.includes(String(item.formation))
    && ["DEFENSIVE", "BALANCED", "ATTACKING"].includes(String(item.mentality))
    && ["LOW_BLOCK", "MID_BLOCK", "HIGH_PRESS"].includes(String(item.pressing))
    && ["SLOW", "NORMAL", "FAST"].includes(String(item.tempo))
    && ["SHORT", "MIXED", "DIRECT"].includes(String(item.passingStyle));
  if (!valid) return fallback;
  return {
    formation: String(item.formation),
    mentality: String(item.mentality) as MatchFallbackPlan["mentality"],
    pressing: String(item.pressing) as MatchFallbackPlan["pressing"],
    tempo: String(item.tempo) as MatchFallbackPlan["tempo"],
    passingStyle: String(item.passingStyle) as MatchFallbackPlan["passingStyle"],
  };
}

export async function getMatchFallbackPlan(userId: string) {
  const club = await prisma.club.findUnique({
    where: { ownerId: userId },
    select: {
      id: true, formation: true, mentality: true, pressing: true, tempo: true,
      passingStyle: true, matchFallbackPlan: true, matchFallbackPlanVersion: true,
    },
  });
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
  const club = await prisma.club.findUnique({
    where: { ownerId: userId },
    select: { id: true, matchFallbackPlanVersion: true },
  });
  if (!club) throw new MatchFallbackPlanError("CLUB_NOT_FOUND");
  const result = await prisma.club.updateMany({
    where: { id: club.id, matchFallbackPlanVersion: expectedVersion },
    data: {
      matchFallbackPlan: plan as unknown as Prisma.InputJsonValue,
      matchFallbackPlanVersion: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new MatchFallbackPlanError("FALLBACK_PLAN_VERSION_CONFLICT");
  return { plan, version: expectedVersion + 1, isCustom: true };
}
