import assert from "node:assert/strict";
import test from "node:test";
import { buildAllianceSeasonStandings } from "../src/groups/alliance-security.js";

const startsAt = new Date("2026-01-01T00:00:00.000Z");
const endsAt = new Date("2026-02-01T00:00:00.000Z");
const joinedAt = new Date("2026-01-02T00:00:00.000Z");

test("season standings count only net eligible points earned during membership and season windows", () => {
  const groups = [
    { groupId: "g1", group: "Alpha", joinedAt },
    { groupId: "g2", group: "Beta", joinedAt: startsAt },
  ];
  const entries = [
    { groupId: "g1", userId: "u1", amount: 100n, source: "GAME_ACTIVITY", createdAt: new Date("2026-01-10T00:00:00Z") },
    { groupId: "g1", userId: "u1", amount: -50n, source: "CHALLENGE_REWARD", createdAt: new Date("2026-01-11T00:00:00Z") },
    { groupId: "g1", userId: "u1", amount: 50n, source: "CHALLENGE_REWARD", createdAt: new Date("2026-01-12T00:00:00Z") },
    { groupId: "g1", userId: "u2", amount: 20n, source: "DAILY_ACTIVITY", createdAt: new Date("2026-01-12T00:00:00Z") },
    { groupId: "g1", userId: "u1", amount: 900n, source: "ADMIN_ADJUSTMENT", createdAt: new Date("2026-01-13T00:00:00Z") },
    { groupId: "g1", userId: "u1", amount: 900n, source: "GAME_ACTIVITY", createdAt: new Date("2025-12-31T23:59:59Z") },
    { groupId: "g1", userId: "u1", amount: 900n, source: "GAME_ACTIVITY", createdAt: new Date("2026-02-01T00:00:00Z") },
    { groupId: "g1", userId: "u1", amount: 900n, source: "GAME_ACTIVITY", createdAt: new Date("2026-01-01T12:00:00Z") },
    { groupId: "g2", userId: "u3", amount: 45n, source: "LEAGUE_REWARD", createdAt: new Date("2026-01-20T00:00:00Z") },
  ];
  const result = buildAllianceSeasonStandings(groups, entries, startsAt, endsAt);
  assert.deepEqual(result.standings.map(x => [x.group, x.points]), [["Beta", "45"], ["Alpha", "120"]]);
  assert.equal(result.securityFlags.length, 1);
  assert.equal(result.securityFlags[0]?.groupId, "g1");
  assert.equal(result.securityFlags[0]?.sharePercent, 83.33);
});

test("season security review does not flag balanced member contributions or small totals", () => {
  const groups = [{ groupId: "g1", group: "Alpha", joinedAt: startsAt }];
  const entries = [
    { groupId: "g1", userId: "u1", amount: 20n, source: "GAME_ACTIVITY", createdAt: new Date("2026-01-10T00:00:00Z") },
    { groupId: "g1", userId: "u2", amount: 20n, source: "GAME_ACTIVITY", createdAt: new Date("2026-01-10T00:00:00Z") },
  ];
  const result = buildAllianceSeasonStandings(groups, entries, startsAt, endsAt);
  assert.equal(result.standings[0]?.points, "40");
  assert.equal(result.securityFlags.length, 0);
});
