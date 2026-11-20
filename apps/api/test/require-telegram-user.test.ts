import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { requireTelegramUser } from "../src/auth/require-telegram-user.js";
import { withTelegramUserLookupPort } from "../src/auth/telegram-user-lookup-context.js";

test("Bot shared-secret authentication accepts a numeric Telegram ID", async () => {
  const previousSecret = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "test-bot-secret";
  let lookedUpTelegramId: string | null = null;
  const request = {
    headers: {
      "x-football-bot-secret": "test-bot-secret",
      "x-telegram-user-id": "123456789",
    },
  } as unknown as FastifyRequest;

  try {
    const user = await withTelegramUserLookupPort({
      async loadActiveUser(telegramId) {
        lookedUpTelegramId = telegramId;
        return {
          id: "user-1",
          telegramId,
          username: null,
          displayName: "Test User",
          createdAt: "2026-11-19T00:00:00.000Z",
        };
      },
    }, () => requireTelegramUser(request));

    assert.equal(lookedUpTelegramId, "123456789");
    assert.equal(user?.id, "user-1");
  } finally {
    if (previousSecret === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previousSecret;
  }
});

test("Bot shared-secret authentication rejects a non-numeric Telegram ID", async () => {
  const previousSecret = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "test-bot-secret";
  let lookupCalled = false;
  const request = {
    headers: {
      "x-football-bot-secret": "test-bot-secret",
      "x-telegram-user-id": "not-a-telegram-id",
    },
  } as unknown as FastifyRequest;

  try {
    const user = await withTelegramUserLookupPort({
      async loadActiveUser() {
        lookupCalled = true;
        return null;
      },
    }, () => requireTelegramUser(request));

    assert.equal(user, null);
    assert.equal(lookupCalled, false);
  } finally {
    if (previousSecret === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previousSecret;
  }
});
