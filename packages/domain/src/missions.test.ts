import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DAILY_MISSIONS, claimMission, getMissionViews } from "./missions.js";

describe("mission domain rules", () => {
  it("marks a completed mission as claimable and caps displayed progress", () => {
    const views = getMissionViews(DAILY_MISSIONS, [{ missionId: "daily_play_1", progress: 99, claimedAt: null }]);
    assert.equal(views[0]?.progress, 1);
    assert.equal(views[0]?.claimable, true);
  });

  it("prevents claiming incomplete or already claimed missions", () => {
    assert.deepEqual(claimMission("daily_win_1", DAILY_MISSIONS, []), { ok: false, reason: "not_completed" });
    assert.deepEqual(claimMission("daily_play_1", DAILY_MISSIONS, [{ missionId: "daily_play_1", progress: 1, claimedAt: new Date() }]), { ok: false, reason: "already_claimed" });
  });

  it("returns the configured reward only for a valid claim", () => {
    assert.deepEqual(claimMission("daily_goals_3", DAILY_MISSIONS, [{ missionId: "daily_goals_3", progress: 3, claimedAt: null }]), { ok: true, reward: { asset: "HONOR", amount: 10 } });
  });
});
