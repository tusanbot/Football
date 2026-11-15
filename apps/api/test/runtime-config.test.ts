import assert from "node:assert/strict";
import test from "node:test";
import { isValidTelegramBotToken, parseAdminTelegramIds } from "../src/runtime-config.js";

test("accepts a BotFather token with a numeric bot id", () => {
  assert.equal(isValidTelegramBotToken("123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"), true);
});

test("rejects malformed Telegram bot tokens", () => {
  for (const token of ["", "abc:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi", "12345:", "123456:short", "123456:bad.token"]) {
    assert.equal(isValidTelegramBotToken(token), false, token);
  }
});

test("accepts comma-separated numeric administrator Telegram IDs", () => {
  assert.deepEqual(parseAdminTelegramIds("123456, 987654321"), ["123456", "987654321"]);
});

test("rejects missing or malformed administrator Telegram IDs", () => {
  for (const value of [undefined, "", "123abc", "123,not-a-number", "-123"]) {
    assert.deepEqual(parseAdminTelegramIds(value), []);
  }
});


test("recognizes Telegram numeric identifiers and numeric amounts", () => {
  assert.match("123456789", /^\d{1,20}$/);
  assert.match("-1001234567890", /^-?\d{5,20}$/);
  assert.match("250000", /^\d{1,12}$/);
});
