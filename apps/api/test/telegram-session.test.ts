import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramSessionToken, verifyTelegramSessionToken, TELEGRAM_SESSION_TTL_SECONDS } from "../src/auth/telegram-session.js";

const secret = "a-secure-test-secret-with-at-least-32-characters";

test("creates and verifies a signed Telegram API session", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");
  const issued = createTelegramSessionToken("123456789", secret, now);
  const claims = verifyTelegramSessionToken(issued.token, secret, now);
  assert.deepEqual(claims, {
    telegramId: "123456789",
    issuedAt: Math.floor(now.getTime() / 1000),
    expiresAt: Math.floor(now.getTime() / 1000) + TELEGRAM_SESSION_TTL_SECONDS,
  });
});

test("rejects tampered, expired, malformed, and wrong-secret sessions", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");
  const issued = createTelegramSessionToken("123456789", secret, now);
  assert.equal(verifyTelegramSessionToken(issued.token + "x", secret, now), null);
  assert.equal(verifyTelegramSessionToken(issued.token, secret + "-wrong", now), null);
  assert.equal(verifyTelegramSessionToken("not-a-session", secret, now), null);
  assert.equal(verifyTelegramSessionToken(issued.token, secret, new Date(now.getTime() + (TELEGRAM_SESSION_TTL_SECONDS + 1) * 1000)), null);
});

test("rejects sessions with invalid Telegram IDs or weak signing secrets", () => {
  assert.throws(() => createTelegramSessionToken("not-numeric", secret), /INVALID_SESSION_CONFIGURATION/);
  assert.throws(() => createTelegramSessionToken("123456", "weak"), /INVALID_SESSION_CONFIGURATION/);
});
