export interface AllianceSeasonGroupInput {
  groupId: string;
  group: string;
  joinedAt: Date;
}
export interface AllianceSeasonLedgerEntry {
  groupId: string;
  userId: string | null;
  amount: bigint;
  source: string;
  createdAt: Date;
}
export interface AllianceSeasonSecurityFlag {
  code: "SINGLE_MEMBER_CONCENTRATION";
  groupId: string;
  group: string;
  memberPoints: string;
  totalPoints: string;
  sharePercent: number;
}
const ELIGIBLE_SOURCES = new Set(["DAILY_ACTIVITY", "GAME_ACTIVITY", "CHALLENGE_REWARD", "LEAGUE_REWARD"]);
const MIN_FLAGGED_SCORE = 30n;
const MIN_FLAGGED_MEMBER_SCORE = 30n;
const CONCENTRATION_PERCENT = 80;

export function buildAllianceSeasonStandings(
  groups: AllianceSeasonGroupInput[],
  entries: AllianceSeasonLedgerEntry[],
  startsAt: Date,
  endsAt: Date,
): { standings: Array<{ rank: number; groupId: string; group: string; points: string }>; securityFlags: AllianceSeasonSecurityFlag[] } {
  const totals = new Map<string, bigint>();
  const memberTotals = new Map<string, Map<string, bigint>>();
  for (const group of groups) {
    totals.set(group.groupId, 0n);
    memberTotals.set(group.groupId, new Map());
  }
  for (const entry of entries) {
    if (!ELIGIBLE_SOURCES.has(entry.source) || entry.createdAt < startsAt || entry.createdAt >= endsAt) continue;
    const group = groups.find(x => x.groupId === entry.groupId);
    if (!group || entry.createdAt < group.joinedAt) continue;
    totals.set(entry.groupId, (totals.get(entry.groupId) ?? 0n) + entry.amount);
    if (entry.userId) {
      const members = memberTotals.get(entry.groupId)!;
      members.set(entry.userId, (members.get(entry.userId) ?? 0n) + entry.amount);
    }
  }
  const securityFlags: AllianceSeasonSecurityFlag[] = [];
  const ranked = groups.map(group => {
    const net = totals.get(group.groupId) ?? 0n;
    const score = net > 0n ? net : 0n;
    const memberScores = [...(memberTotals.get(group.groupId)?.values() ?? [])].filter(x => x > 0n);
    const topMember = memberScores.reduce((max, value) => value > max ? value : max, 0n);
    if (score >= MIN_FLAGGED_SCORE && topMember >= MIN_FLAGGED_MEMBER_SCORE && topMember * 100n >= score * BigInt(CONCENTRATION_PERCENT)) {
      securityFlags.push({
        code: "SINGLE_MEMBER_CONCENTRATION",
        groupId: group.groupId,
        group: group.group,
        memberPoints: topMember.toString(),
        totalPoints: score.toString(),
        sharePercent: Number((topMember * 10000n) / score) / 100,
      });
    }
    return { groupId: group.groupId, group: group.group, points: score.toString() };
  }).sort((a, b) => BigInt(a.points) > BigInt(b.points) ? -1 : BigInt(a.points) < BigInt(b.points) ? 1 : a.group.localeCompare(b.group));
  return { standings: ranked.map((x, index) => ({ rank: index + 1, ...x })), securityFlags };
}
