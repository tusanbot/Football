import assert from "node:assert/strict";
import test from "node:test";
import {
  GROUP_REPLY_DELETE_DELAY_MS,
  PRIVATE_MENU_ROWS,
  PERSISTENT_GROUP_COMMANDS,
  isPersistentGroupReply,
  resolvePrivateMenuCommand,
} from "../src/telegram-ux.js";

test("group replies use a one-minute transient retention window", () => {
  assert.equal(GROUP_REPLY_DELETE_DELAY_MS, 60_000);
});

test("all private keyboard buttons resolve to existing no-argument commands", () => {
  const expected = [
    "club", "wallet", "players", "lineup", "development", "operations",
    "finance", "scout", "opponents", "matches", "leagues", "market",
    "special", "help", "menu",
  ];
  const actual = PRIVATE_MENU_ROWS.flat().map((item) => resolvePrivateMenuCommand(item.label));
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, expected.length);
});

test("private menu label matching tolerates whitespace and Persian Arabic variants", () => {
  assert.equal(resolvePrivateMenuCommand("  🏟 باشگاه  "), "club");
  assert.equal(resolvePrivateMenuCommand("💰 کیف پول"), "wallet");
  assert.equal(resolvePrivateMenuCommand("❔ راهنما"), "help");
});

test("unknown private text is not converted into a command", () => {
  assert.equal(resolvePrivateMenuCommand("سلام"), undefined);
  assert.equal(resolvePrivateMenuCommand("/club"), undefined);
});

test("administrative group commands remain persistent", () => {
  for (const command of [
    "group-register", "group-check", "group-give", "group-challenge",
    "group-challenge-complete", "group-challenge-cancel", "group-rewards",
    "group-treasury", "alliance-create", "alliance-season-review",
  ]) {
    assert.equal(isPersistentGroupReply(command, "عملیات انجام شد"), true, command);
  }
  assert.ok(PERSISTENT_GROUP_COMMANDS.has("group-league-table"));
});

test("ranking and standings replies remain persistent", () => {
  for (const text of ["League table", "Top ranking", "جدول نهایی", "رتبه‌بندی گروه‌ها"]) {
    assert.equal(isPersistentGroupReply(undefined, text), true, text);
  }
});

test("ordinary group replies remain transient by default", () => {
  assert.equal(isPersistentGroupReply("group-activity", "امتیاز روزانه ثبت شد"), false);
  assert.equal(isPersistentGroupReply("group-shop", "فهرست فروشگاه"), false);
  assert.equal(isPersistentGroupReply(undefined, "سلام به همه"), false);
});
