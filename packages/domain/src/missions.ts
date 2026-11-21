export type MissionMetric = "matches_played" | "matches_won" | "goals_scored" | "training_sessions";
export type MissionRewardAsset = "CASH" | "GOLD" | "HONOR";

export interface MissionDefinition {
  id: string;
  title: string;
  description: string;
  metric: MissionMetric;
  target: number;
  reward: { asset: MissionRewardAsset; amount: number };
  repeatable: boolean;
}

export interface MissionProgress {
  missionId: string;
  progress: number;
  claimedAt: Date | null;
}

export interface MissionView extends MissionDefinition {
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimable: boolean;
}

export const DAILY_MISSIONS: readonly MissionDefinition[] = [
  { id: "daily_play_1", title: "اولین سوت", description: "یک مسابقه انجام بده.", metric: "matches_played", target: 1, reward: { asset: "CASH", amount: 500 }, repeatable: false },
  { id: "daily_win_1", title: "سه امتیاز", description: "یک مسابقه را ببر.", metric: "matches_won", target: 1, reward: { asset: "GOLD", amount: 2 }, repeatable: false },
  { id: "daily_goals_3", title: "خط حمله", description: "سه گل به ثمر برسان.", metric: "goals_scored", target: 3, reward: { asset: "HONOR", amount: 10 }, repeatable: false },
  { id: "daily_train_1", title: "تمرین روزانه", description: "یک جلسه تمرین انجام بده.", metric: "training_sessions", target: 1, reward: { asset: "CASH", amount: 300 }, repeatable: false },
] as const;

export interface MissionClaimResult {
  ok: boolean;
  reason?: "unknown_mission" | "not_completed" | "already_claimed";
  reward?: MissionDefinition["reward"];
}

/** Pure rules: persistence and wallet crediting are handled by the Supabase service. */
export function getMissionViews(
  definitions: readonly MissionDefinition[],
  progressRows: readonly MissionProgress[],
): MissionView[] {
  const rows = new Map(progressRows.map((row) => [row.missionId, row]));
  return definitions.map((mission) => {
    const row = rows.get(mission.id);
    const progress = Math.min(mission.target, Math.max(0, row?.progress ?? 0));
    const completed = progress >= mission.target;
    const claimed = row?.claimedAt != null;
    return { ...mission, progress, completed, claimed, claimable: completed && !claimed };
  });
}

export function claimMission(
  missionId: string,
  definitions: readonly MissionDefinition[],
  progressRows: readonly MissionProgress[],
): MissionClaimResult {
  const mission = definitions.find((item) => item.id === missionId);
  if (!mission) return { ok: false, reason: "unknown_mission" };
  const row = progressRows.find((item) => item.missionId === missionId);
  if ((row?.progress ?? 0) < mission.target) return { ok: false, reason: "not_completed" };
  if (row?.claimedAt != null) return { ok: false, reason: "already_claimed" };
  return { ok: true, reward: mission.reward };
}
