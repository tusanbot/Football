import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  GROUP_REPLY_DELETE_DELAY_MS,
  PRIVATE_MENU_ROWS,
  PERSISTENT_GROUP_COMMANDS,
  TRANSIENT_GROUP_COMMANDS,
  isPersistentGroupReply,
  resolvePrivateMenuCommand,
} from "../src/telegram-ux.js";

const botSource = await readFile(new URL("../src/bot.ts", import.meta.url), "utf8");

test("group replies use a one-minute transient retention window", () => {
  assert.equal(GROUP_REPLY_DELETE_DELAY_MS, 60_000);
});

test("every private keyboard button resolves to a registered no-argument command", () => {
  const expected = [
    "club", "wallet", "players", "lineup", "development", "operations",
    "finance", "scout", "opponents", "matches", "leagues", "market",
    "special", "help", "menu",
  ];
  const actual = PRIVATE_MENU_ROWS.flat().map((item) => resolvePrivateMenuCommand(item.label));
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, expected.length);

  const registered = new Set(
    [...botSource.matchAll(/bot\\.command\\(\\s*["']([^"']+)["']/g)].map((match) => match[1]),
  );
  for (const command of expected) {
    assert.ok(registered.has(command), `Reply Keyboard command / ${command} has no bot.command handler`);
  }
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

test("all group commands have an explicit transient or persistent classification", () => {
  const expected = [
    "group-register", "group-join", "group", "group-activity", "group-shop",
    "group-buy", "group-challenges", "group-challenge", "group-challenge-join",
    "group-challenge-complete", "group-check", "group-league", "group-league-join",
    "group-league-start", "group-league-table", "group-rewards", "group-treasury",
    "group-give", "group-challenge-cancel", "group-leagues", "alliance",
    "alliance-create", "alliance-invite", "alliance-accept", "alliance-decline",
    "alliance-championship", "alliance-championship-join",
    "alliance-championship-start", "alliance-season-start", "alliance-season-close",
    "alliance-season-review", "alliance-contribute",
  ];
  const classified = new Set([...PERSISTENT_GROUP_COMMANDS, ...TRANSIENT_GROUP_COMMANDS]);
  assert.equal(PERSISTENT_GROUP_COMMANDS.size + TRANSIENT_GROUP_COMMANDS.size, classified.size,
    "a group command cannot be both transient and persistent");
  assert.deepEqual([...classified].sort(), [...expected].sort());
});

test("administrative and ranking replies remain persistent", () => {
  for (const command of [
    "group-register", "group-check", "group-give", "group-challenge",
    "group-challenge-complete", "group-challenge-cancel", "group-rewards",
    "group-treasury", "alliance-create", "alliance-season-review",
  ]) {
    assert.equal(isPersistentGroupReply(command, "عملیات انجام شد"), true, command);
  }
  assert.ok(PERSISTENT_GROUP_COMMANDS.has("group-league-table"));
  for (const text of ["League table", "Top ranking", "جدول نهایی", "رتبه‌بندی گروه‌ها"]) {
    assert.equal(isPersistentGroupReply(undefined, text), true, text);
  }
});

test("ordinary group replies remain transient, including explicitly transient commands", () => {
  for (const command of TRANSIENT_GROUP_COMMANDS) {
    assert.equal(isPersistentGroupReply(command, "عملیات انجام شد"), false, command);
  }
  assert.equal(isPersistentGroupReply(undefined, "سلام به همه"), false);
});

test("group reply retention middleware is installed before command handlers", () => {
  const wrapperIndex = botSource.indexOf('Object.defineProperty(ctx, "reply"');
  const firstCommandIndex = botSource.indexOf('bot.command("start"');
  assert.ok(wrapperIndex >= 0 && firstCommandIndex > wrapperIndex);
});

test("bot source does not bypass the group reply retention wrapper with direct sends", () => {
  const directSendPattern =
    /(?:ctx|bot)\\.api\\.(?:sendMessage|sendPhoto|sendDocument|sendVideo|sendAudio|sendAnimation|sendMediaGroup|sendLocation|sendVenue|sendPoll|sendSticker|sendVoice|sendVideoNote)|ctx\\.replyWith(?:Photo|Document|Video|Audio|Animation|MediaGroup|Location|Venue|Poll|Sticker|Voice|VideoNote)/g;
  assert.deepEqual([...botSource.matchAll(directSendPattern)].map((match) => match[0]), []);
});
