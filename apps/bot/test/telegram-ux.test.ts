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
  formatApiError,
  limitTelegramMessage,
} from "../src/telegram-ux.js";

const botSource = await readFile(new URL("../src/bot.ts", import.meta.url), "utf8");

test("group replies use a one-minute transient retention window", () => {
  assert.equal(GROUP_REPLY_DELETE_DELAY_MS, 60_000);
});

test("every private keyboard button resolves to a registered no-argument command", () => {
  const expected = [
    "club", "wallet", "players", "lineup", "development", "operations",
    "finance", "scout", "opponents", "matches", "fallback", "leagues", "market",
    "special", "seasonawards", "records", "help", "menu",
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
  for (const text of ["League table", "Top ranking", "جدول نهایی", "رتبه‌بندی گروه‌ها", "رتبه‌بندی بهترین گلزنان تاریخ", "رتبه‌بندی بالاترین میانگین نمره"]) {
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
  const directSends = [...botSource.matchAll(directSendPattern)].map((match) => match[0]);
  // Two direct sends are private-user league notices; the third is the durable
  // admin broadcast worker. All group deliveries are intentionally persistent.
  assert.deepEqual(directSends, ["bot.api.sendMessage", "bot.api.sendMessage", "bot.api.sendMessage"]);
  assert.equal((botSource.match(/bot\.api\.sendMessage\(telegramId/g) ?? []).length, 2);
  assert.ok(botSource.includes("bot.api.sendMessage(Number(delivery.telegramGroupId), delivery.message)"));
  assert.ok(botSource.includes("/v1/bot/admin-group-broadcasts/"));
  assert.ok(/" \+ delivery\.id \+ "\/complete"/.test(botSource));
});

test("private menu stays compact and every button remains uniquely routable", () => {
  assert.equal(PRIVATE_MENU_ROWS.length, 9);
  assert.ok(PRIVATE_MENU_ROWS.every((row) => row.length === 2));
  assert.equal(new Set(PRIVATE_MENU_ROWS.flat().map((item) => item.command)).size, 18);
});

test("admin command argument parsing uses whitespace-aware splitting", () => {
  assert.equal(botSource.includes("split(/s+/)"), false);
  assert.ok(botSource.includes("const [id,state]=rest.split(/\\s+/);"));
  assert.ok(botSource.includes("const parts=input.split(/\\s+/);"));
});

test("onboarding and help copy are Persian-first", () => {
  assert.ok(botSource.includes("به Football Empire خوش آمدید"));
  assert.ok(botSource.includes("راهنمای Football Empire"));
  assert.ok(botSource.includes("برای بازگشت به منوی دکمه‌ای"));
});


test("Persian help documents the non-administrative game commands", () => {
  const documented = [
    "redeem", "group-register", "group-join", "group-activity", "group-shop", "group-buy",
    "group-challenges", "group-challenge", "group-challenge-join", "group-challenge-complete",
    "group-check", "group-league", "group-league-join", "group-league-start", "group-league-table",
    "group-rewards", "group-treasury", "group-give", "group-challenge-cancel", "group-leagues",
    "setlineup", "development", "operations", "ticket-price", "coach-upgrade", "hire-coach",
    "acceptchallenge", "pyramidleagues", "leaguehistory", "pyramidtable", "leagueapply",
    "promotion", "leaguenotices", "matches", "tactic", "sub", "fallback", "setfallback",
    "competitionrules", "joinleague", "startleague", "startcup", "table",
    "alliance-championship-join", "alliance-championship-start", "alliance-season-review",
    "alliance-contribute", "setlogo", "seasonawards", "records", "clubcompare",
  ];
  for (const command of documented) {
    assert.ok(botSource.includes("/" + command), "Persian /help is missing /" + command);
  }
});

test("common game API failures are presented in Persian without exposing internals", () => {
  assert.match(formatApiError("INSUFFICIENT_CASH"), /موجودی کش/);
  assert.match(formatApiError("GROUP_MANAGER_REQUIRED"), /مدیران/);
  assert.match(formatApiError("CONCURRENT_MODIFICATION"), /هم‌زمان/);
  assert.match(formatApiError("MATCH_RUNTIME_AUTOMATIC"), /خودکار/);
  assert.match(formatApiError("UNRECOGNIZED_CODE"), /کد خطا/);
});

test("Telegram replies are capped below the platform message limit", () => {
  const long = "x".repeat(5000);
  const safe = limitTelegramMessage(long);
  assert.equal(safe.length, 3900);
  assert.equal(safe.endsWith("…"), true);
  assert.equal(limitTelegramMessage("short"), "short");
});
