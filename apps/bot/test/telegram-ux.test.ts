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
    [...botSource.matchAll(/bot\.command\(\s*["']([^"']+)["']/g)].map((match) => match[1]),
  );
  for (const command of expected) {
    assert.ok(registered.has(command), "Reply Keyboard command /" + command + " has no bot.command handler");
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

test("every registered group command has an explicit transient or persistent classification", () => {
  const staticGroupCommands = [...botSource.matchAll(/bot\.command\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((command) => command === "group" || command.startsWith("group-") || command.startsWith("alliance"));
  // These two aliases are registered from the alliance response loop rather than bot.command literals.
  const dynamicGroupCommands = ["alliance-accept", "alliance-decline"];
  for (const command of dynamicGroupCommands) {
    assert.ok(botSource.includes('"' + command + '"'), "Missing dynamic group command registration: " + command);
  }
  const registeredGroupCommands = new Set([...staticGroupCommands, ...dynamicGroupCommands]);
  const classified = new Set([...PERSISTENT_GROUP_COMMANDS, ...TRANSIENT_GROUP_COMMANDS]);

  assert.equal(PERSISTENT_GROUP_COMMANDS.size + TRANSIENT_GROUP_COMMANDS.size, classified.size,
    "a group command cannot be both transient and persistent");
  assert.deepEqual([...classified].sort(), [...registeredGroupCommands].sort());
});

test("the manual group cleanup test command is explicitly transient", () => {
  assert.ok(TRANSIENT_GROUP_COMMANDS.has("group-cleanup-test"));
  assert.ok(botSource.includes('bot.command("group-cleanup-test"'));
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
    /(?:ctx|bot)\.api\.(?:sendMessage|sendPhoto|sendDocument|sendVideo|sendAudio|sendAnimation|sendMediaGroup|sendLocation|sendVenue|sendPoll|sendSticker|sendVoice|sendVideoNote)|ctx\.replyWith(?:Photo|Document|Video|Audio|Animation|MediaGroup|Location|Venue|Poll|Sticker|Voice|VideoNote)/g;
  assert.deepEqual([...botSource.matchAll(directSendPattern)].map((match) => match[0]), []);
});
