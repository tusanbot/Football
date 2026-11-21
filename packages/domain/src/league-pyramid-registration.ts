export const PYRAMID_LEAGUE_TEAM_CAPACITY = 8;

export type LeagueApplication = {
  clubId: string;
  appliedAt: Date;
};

export type LeagueApplicationAssignment = {
  clubId: string;
  tier: number;
  season: number;
  groupNumber: number;
};

export type LeagueApplicationAllocation = {
  assignments: LeagueApplicationAssignment[];
  queuedClubIds: string[];
  groupsFilled: number;
};

/**
 * Assigns applications in FIFO order. Only complete groups of eight are
 * allocated; partial groups remain queued and must not be started.
 */
export function allocatePyramidLeagueApplications(input: {
  applications: readonly LeagueApplication[];
  tier: number;
  season: number;
  firstGroupNumber?: number;
}): LeagueApplicationAllocation {
  if (!Number.isInteger(input.tier) || input.tier < 1 || input.tier > 7) {
    throw new Error("INVALID_LEAGUE_TIER");
  }
  if (!Number.isInteger(input.season) || input.season < 1) {
    throw new Error("INVALID_LEAGUE_SEASON");
  }
  const firstGroupNumber = input.firstGroupNumber ?? 1;
  if (!Number.isInteger(firstGroupNumber) || firstGroupNumber < 1) {
    throw new Error("INVALID_LEAGUE_GROUP_NUMBER");
  }

  const seen = new Set<string>();
  for (const application of input.applications) {
    if (!application.clubId.trim()) throw new Error("INVALID_LEAGUE_APPLICATION");
    if (seen.has(application.clubId)) throw new Error("DUPLICATE_LEAGUE_APPLICATION");
    if (!(application.appliedAt instanceof Date) || Number.isNaN(application.appliedAt.getTime())) {
      throw new Error("INVALID_LEAGUE_APPLICATION_DATE");
    }
    seen.add(application.clubId);
  }

  const ordered = [...input.applications].sort((a, b) =>
    a.appliedAt.getTime() - b.appliedAt.getTime() || a.clubId.localeCompare(b.clubId));
  const groupsFilled = Math.floor(ordered.length / PYRAMID_LEAGUE_TEAM_CAPACITY);
  const assignedCount = groupsFilled * PYRAMID_LEAGUE_TEAM_CAPACITY;
  const assignments = ordered.slice(0, assignedCount).map((application, index) => ({
    clubId: application.clubId,
    tier: input.tier,
    season: input.season,
    groupNumber: firstGroupNumber + Math.floor(index / PYRAMID_LEAGUE_TEAM_CAPACITY),
  }));

  return {
    assignments,
    queuedClubIds: ordered.slice(assignedCount).map((application) => application.clubId),
    groupsFilled,
  };
}

/** A pyramid league can enter registration-to-active transition only at 8 teams. */
export function canStartPyramidLeague(teamCount: number): boolean {
  return Number.isInteger(teamCount) && teamCount === PYRAMID_LEAGUE_TEAM_CAPACITY;
}

/** Rejects malformed persisted league sizes instead of silently starting partial leagues. */
export function assertPyramidLeagueReady(teamCount: number): void {
  if (!canStartPyramidLeague(teamCount)) {
    throw new Error("PYRAMID_LEAGUE_REQUIRES_EIGHT_TEAMS");
  }
}
