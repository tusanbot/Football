import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyTelegramInitData } from "../src/auth/telegram-init-data.js";

const botToken = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";

function makeInitData(user: Record<string, unknown>, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAE-test-query",
    user: JSON.stringify(user),
  });
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

test("accepts correctly signed, recent Telegram initData", () => {
  const now = new Date("2026-11-14T10:00:00.000Z");
  const authDate = Math.floor(now.getTime() / 1000);
  const result = verifyTelegramInitData(
    makeInitData({ id: 123456, first_name: "Test", username: "tester" }, authDate),
    botToken,
    { now },
  );
  assert.equal(result.user.id, 123456);
  assert.equal(result.user.username, "tester");
  assert.equal(result.queryId, "AAE-test-query");
});

test("rejects tampered and expired initData", () => {
  const now = new Date("2026-11-14T10:00:00.000Z");
  const authDate = Math.floor(now.getTime() / 1000);
  const valid = makeInitData({ id: 123456, first_name: "Test" }, authDate);
  assert.throws(
    () => verifyTelegramInitData(valid.replace("Test", "Evil"), botToken, { now }),
    /signature verification failed/,
  );
  assert.throws(
    () => verifyTelegramInitData(
      makeInitData({ id: 123456, first_name: "Test" }, authDate - 301),
      botToken,
      { now },
    ),
    /expired/,
  );
});

test("rejects malformed Telegram user payloads", () => {
  const now = new Date("2026-11-14T10:00:00.000Z");
  const authDate = Math.floor(now.getTime() / 1000);
  assert.throws(
    () => verifyTelegramInitData(makeInitData({ id: -1, first_name: "Test" }, authDate), botToken, { now }),
    /user payload is invalid/,
  );
});

test("rejects duplicate signed fields before interpreting identity", () => {
  const now = new Date("2026-11-14T10:00:00.000Z");
  const authDate = Math.floor(now.getTime() / 1000);
  const valid = makeInitData({ id: 123456, first_name: "Test" }, authDate);
  assert.throws(() => verifyTelegramInitData(valid + "&user=%7B%22id%22%3A999%2C%22first_name%22%3A%22Other%22%7D", botToken, { now }), /Duplicate/);
});

test("rejects empty names and malformed optional profile fields", () => {
  const now = new Date("2026-11-14T10:00:00.000Z");
  const authDate = Math.floor(now.getTime() / 1000);
  for (const user of [
    { id: 123456, first_name: "   " },
    { id: 123456, first_name: "Test", username: "bad username" },
    { id: 123456, first_name: "Test", is_premium: "true" },
  ]) {
    assert.throws(() => verifyTelegramInitData(makeInitData(user, authDate), botToken, { now }), /user payload is invalid/);
  }
});

test("rejects oversized payloads and invalid age policies", () => {
  assert.throws(() => verifyTelegramInitData("x".repeat(8193), botToken), /size/);
  assert.throws(() => verifyTelegramInitData("auth_date=1&hash=" + "a".repeat(64), botToken, { maxAgeSeconds: 0 }), /age policy/);
});
