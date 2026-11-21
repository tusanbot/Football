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
    { groupId: "g2", userId: "u3", amount: 30n, source: "LEAGUE_REWARD", createdAt: new Date("2026-01-20T00:00:00Z") },
    { groupId: "g2", userId: "u4", amount: 15n, source: "GAME_ACTIVITY", createdAt: new Date("2026-01-21T00:00:00Z") },
  ];
  const result = buildAllianceSeasonStandings(groups, entries, startsAt, endsAt);
  assert.deepEqual(result.standings.map(x => [x.group, x.points]), [["Alpha", "120"], ["Beta", "45"]]);
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

test("flags repeated high-value scoring by the same account across multiple alliance groups", () => {
 const groups=[{groupId:"g1",group:"Alpha",joinedAt:startsAt},{groupId:"g2",group:"Beta",joinedAt:startsAt}];
 const entries=[
  {groupId:"g1",userId:"shared-user",amount:60n,source:"GAME_ACTIVITY",createdAt:new Date("2026-01-10T00:00:00Z")},
  {groupId:"g2",userId:"shared-user",amount:55n,source:"LEAGUE_REWARD",createdAt:new Date("2026-01-11T00:00:00Z")},
  {groupId:"g1",userId:"other-user",amount:20n,source:"DAILY_ACTIVITY",createdAt:new Date("2026-01-12T00:00:00Z")},
 ];
 const result=buildAllianceSeasonStandings(groups,entries,startsAt,endsAt),flag=result.securityFlags.find(item=>item.code==="CROSS_GROUP_MEMBER_OVERLAP");
 assert.ok(flag);
 if(flag?.code==="CROSS_GROUP_MEMBER_OVERLAP"){assert.equal(flag.groupCount,2);assert.equal(flag.memberPoints,"115");assert.deepEqual(flag.groups.map(group=>group.group),["Alpha","Beta"]);}
});
test("does not flag cross-group overlap below minimum contribution thresholds", () => {
 const groups=[{groupId:"g1",group:"Alpha",joinedAt:startsAt},{groupId:"g2",group:"Beta",joinedAt:startsAt}];
 const entries=[
  {groupId:"g1",userId:"shared-user",amount:20n,source:"GAME_ACTIVITY",createdAt:new Date("2026-01-10T00:00:00Z")},
  {groupId:"g2",userId:"shared-user",amount:20n,source:"GAME_ACTIVITY",createdAt:new Date("2026-01-11T00:00:00Z")},
 ];
 assert.equal(buildAllianceSeasonStandings(groups,entries,startsAt,endsAt).securityFlags.some(item=>item.code==="CROSS_GROUP_MEMBER_OVERLAP"),false);
});
