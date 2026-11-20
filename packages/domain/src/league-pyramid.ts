export const LEAGUE_TIERS = [
  { level: 1, key: "BASE", name: "لیگ پایه", promotionMultiplierBps: 10_000 },
  { level: 2, key: "AMATEUR", name: "لیگ آماتور", promotionMultiplierBps: 11_000 },
  { level: 3, key: "REGIONAL", name: "لیگ منطقه‌ای", promotionMultiplierBps: 12_000 },
  { level: 4, key: "SEMI_PRO", name: "لیگ نیمه‌حرفه‌ای", promotionMultiplierBps: 13_000 },
  { level: 5, key: "PRO", name: "لیگ حرفه‌ای", promotionMultiplierBps: 14_500 },
  { level: 6, key: "ELITE", name: "لیگ برتر (فوق‌حرفه‌ای)", promotionMultiplierBps: 16_000 },
  { level: 7, key: "CHAMPIONS", name: "لیگ قهرمانان", promotionMultiplierBps: 18_000 },
] as const;

export type LeagueTierLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type LeagueStanding = {
  clubId: string; points: number; goalDifference: number; goalsFor: number;
  wins: number; fairPlayScore?: number; clubName?: string;
};
export type PromotionDecision = { clubId: string; position: number; targetTier: number; status: "PENDING" | "ACCEPTED" | "DECLINED" };
export type ChallengeDailyUsage = { freeUsed: number; goldUsed: number; purchasedUsed: number };
export type ChallengeCharge = { asset: "FREE" | "GOLD" | "PURCHASED"; costGold: bigint; nextUsage: ChallengeDailyUsage };

export function leagueTier(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > LEAGUE_TIERS.length) throw new Error("INVALID_LEAGUE_TIER");
  return LEAGUE_TIERS[level - 1]!;
}

/** Deterministic table order: points, GD, goals scored, wins, fair play, then club id. */
export function rankLeagueTeams<T extends LeagueStanding>(teams: readonly T[]): T[] {
  return [...teams].sort((a, b) =>
    b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor
    || b.wins - a.wins || (a.fairPlayScore ?? 0) - (b.fairPlayScore ?? 0)
    || a.clubId.localeCompare(b.clubId));
}

export function resolveLeaguePromotion(standings: readonly LeagueStanding[], tier: number) {
  if (standings.length !== 8) throw new Error("PYRAMID_LEAGUE_REQUIRES_EIGHT_TEAMS");
  if (!Number.isInteger(tier) || tier < 1 || tier > LEAGUE_TIERS.length) throw new Error("INVALID_LEAGUE_TIER");
  const ranked = rankLeagueTeams(standings);
  return {
    champion: ranked[0]!,
    runnerUp: ranked[1]!,
    thirdPlace: ranked[2]!,
    promoted: tier < LEAGUE_TIERS.length ? ranked.slice(0, 2) : [],
    relegated: tier > 1 ? ranked.slice(6, 8) : [],
    finalStandings: ranked.map((team, index) => ({ ...team, position: index + 1 })),
  };
}

/** If a promoted club declines, the next eligible club receives that exact promotion slot. */
export function resolvePromotionDecline(
  standings: readonly LeagueStanding[], declinedClubIds: readonly string[], tier: number,
) {
  const result = resolveLeaguePromotion(standings, tier);
  const declined = new Set(declinedClubIds);
  const eligible = tier < LEAGUE_TIERS.length ? result.finalStandings.filter((row) => row.position >= 1 && !declined.has(row.clubId)) : [];
  return {
    promoted: eligible.slice(0, 2).map((row) => row.clubId),
    declined: result.promoted.filter((row) => declined.has(row.clubId)).map((row) => row.clubId),
    replacements: eligible.filter((row) => row.position > 2).slice(0, result.promoted.filter((row) => declined.has(row.clubId)).length).map((row) => row.clubId),
  };
}

export function calculateLeaguePlayerValue(baseValue: bigint, fromTier: number, toTier: number): bigint {
  if (baseValue < 0n) throw new Error("INVALID_PLAYER_VALUE");
  const from = leagueTier(fromTier);
  const to = leagueTier(toTier);
  const ratio = BigInt(to.promotionMultiplierBps);
  const base = BigInt(from.promotionMultiplierBps);
  return (baseValue * ratio + base / 2n) / base;
}

/** Three free challenges, then two Gold-funded challenges; purchased credits are reserved for a later store integration. */
export function chargeDailyChallenge(usage: ChallengeDailyUsage, goldCost: bigint): ChallengeCharge {
  if (goldCost < 0n) throw new Error("INVALID_CHALLENGE_PRICE");
  if (usage.freeUsed < 3) return { asset: "FREE", costGold: 0n, nextUsage: { ...usage, freeUsed: usage.freeUsed + 1 } };
  if (usage.goldUsed < 2) return { asset: "GOLD", costGold: goldCost, nextUsage: { ...usage, goldUsed: usage.goldUsed + 1 } };
  if (usage.purchasedUsed > 0) return { asset: "PURCHASED", costGold: 0n, nextUsage: { ...usage, purchasedUsed: usage.purchasedUsed - 1 } };
  throw new Error("DAILY_CHALLENGE_LIMIT_REACHED");
}
