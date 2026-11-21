import assert from "node:assert/strict";
import test from "node:test";
import {
  arrangeLegendsDraftLineup,
  createLegendsDraft,
  pickLegendsDraftPlayer,
  type DraftPoolPlayer,
} from "./legends-draft.js";

const pool: DraftPoolPlayer[] = [
  { id: "gk", name: "Keeper", line: "GK", overall: 90 },
  { id: "gk2", name: "Keeper 2", line: "GK", overall: 90 },
  { id: "d1", name: "Defender 1", line: "DEF", overall: 90 },
  { id: "d2", name: "Defender 2", line: "DEF", overall: 90 },
  { id: "m1", name: "Midfielder 1", line: "MID", overall: 90 },
  { id: "m2", name: "Midfielder 2", line: "MID", overall: 90 },
  { id: "a1", name: "Attacker 1", line: "ATT", overall: 90 },
  { id: "a2", name: "Attacker 2", line: "ATT", overall: 90 },
  { id: "a3", name: "Attacker 3", line: "ATT", overall: 90 },
  { id: "d3", name: "Defender 3", line: "DEF", overall: 90 },
  { id: "m3", name: "Midfielder 3", line: "MID", overall: 90 },
];

test("draft serializes picks, alternates users and rejects duplicate picks", () => {
  let state = createLegendsDraft(["u1", "u2"], pool);
  state = pickLegendsDraftPlayer(state, "u1", "gk");
  assert.throws(() => pickLegendsDraftPlayer(state, "u1", "d1"), /DRAFT_NOT_YOUR_TURN/);
  state = pickLegendsDraftPlayer(state, "u2", "d1");
  assert.throws(() => pickLegendsDraftPlayer(state, "u1", "d1"), /DRAFT_PLAYER_ALREADY_PICKED/);
  const remainingPicks = ["d2", "gk2", "m1", "m2", "a1", "a2", "a3", "d3"];
  for (const playerId of remainingPicks) {
    const user = state.users[state.picks.length % 2]!;
    state = pickLegendsDraftPlayer(state, user, playerId);
    assert.equal(state.picks[state.picks.length - 1]?.player.id, playerId);
  }
  assert.equal(state.status, "COMPLETE");
  assert.equal(state.picks.length, 10);
  assert.throws(() => pickLegendsDraftPlayer(state, "u1", "gk"), /DRAFT_ALREADY_COMPLETE/);
});

test("draft rejects invalid users and duplicate pool identities", () => {
  assert.throws(() => createLegendsDraft(["u1", "u1"], pool), /DRAFT_USERS_MUST_DIFFER/);
  assert.throws(() => createLegendsDraft(["u1", "u2"], [...pool, pool[0]!]), /DRAFT_POOL_PLAYER_IDS_MUST_BE_UNIQUE/);\n  assert.throws(() => createLegendsDraft(["u1", "u2"], pool.slice(0, 10).filter((player) => player.line !== "GK" || player.id === "gk")), /DRAFT_POOL_REQUIRES_TWO_GOALKEEPERS_AND_EIGHT_OUTFIELD_PLAYERS/);
  let state = createLegendsDraft(["u1", "u2"], pool);
  state = pickLegendsDraftPlayer(state, "u1", "gk");
  assert.throws(() => pickLegendsDraftPlayer(state, "u1", "gk2"), /DRAFT_NOT_YOUR_TURN/);
  state = pickLegendsDraftPlayer(state, "u2", "d1");
  assert.throws(() => pickLegendsDraftPlayer(state, "u1", "gk2"), /DRAFT_TEAM_ALREADY_HAS_GOALKEEPER/);
});

test("2-1-1 keeps the draft lines unchanged", () => {
  const lineup = arrangeLegendsDraftLineup([pool[0]!, pool[1]!, pool[2]!, pool[3]!, pool[5]!], "2-1-1");
  assert.deepEqual(lineup.lines.DEF.map((p) => p.id), ["d1", "d2"]);
  assert.deepEqual(lineup.lines.MID.map((p) => p.id), ["m1"]);
  assert.deepEqual(lineup.lines.ATT.map((p) => p.id), ["a1"]);
});

test("2-1-1 shifts an excess defender into midfield for 1-2-1", () => {
  const lineup = arrangeLegendsDraftLineup([pool[0]!, pool[1]!, pool[2]!, pool[3]!, pool[5]!], "1-2-1");
  assert.equal(lineup.lines.DEF.length, 1);
  assert.equal(lineup.lines.MID.length, 2);
  assert.equal(lineup.lines.ATT.length, 1);
  assert.deepEqual(lineup.lines.MID.map((p) => p.id), ["m1", "d2"]);
});

test("lineup preserves every selected player and never moves the goalkeeper", () => {
  const selected = [pool[0]!, pool[2]!, pool[4]!, pool[6]!, pool[7]!];
  const lineup = arrangeLegendsDraftLineup(selected, "1-1-2");
  const assigned = [...lineup.lines.DEF, ...lineup.lines.MID, ...lineup.lines.ATT, lineup.goalkeeper];
  assert.deepEqual(new Set(assigned.map((p) => p.id)), new Set(selected.map((p) => p.id)));
  assert.equal(lineup.goalkeeper.id, "gk");
});
