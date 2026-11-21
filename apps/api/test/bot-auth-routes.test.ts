import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("Bot onboarding rejects requests when the server secret is not configured", async () => {
  const previous = process.env.BOT_API_SECRET;
  delete process.env.BOT_API_SECRET;
  const app = buildApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/bot",
      headers: { "x-telegram-user-id": "12345" },
      payload: { firstName: "Test" },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, "BOT_AUTH_NOT_CONFIGURED");
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  }
});

test("Bot onboarding rejects an invalid shared secret", async () => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "expected-secret";
  const app = buildApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/bot",
      headers: {
        "x-football-bot-secret": "wrong-secret",
        "x-telegram-user-id": "12345",
      },
      payload: { firstName: "Test" },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "UNAUTHENTICATED_BOT_REQUEST");
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  }
});

test("Bot onboarding validates profile data before provisioning", async () => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "expected-secret";
  const app = buildApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/bot",
      headers: {
        "x-football-bot-secret": "expected-secret",
        "x-telegram-user-id": "12345",
      },
      payload: { firstName: "" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "INVALID_REQUEST");
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  }
});
