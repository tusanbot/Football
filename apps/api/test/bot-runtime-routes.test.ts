import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("Bot identity verification is protected by the shared Bot API secret", async (t) => {
  const previous = process.env.BOT_API_SECRET;
  process.env.BOT_API_SECRET = "runtime-identity-test-secret";
  const app = buildApp();
  await app.ready();
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.BOT_API_SECRET;
    else process.env.BOT_API_SECRET = previous;
  });
  const response = await app.inject({
    method: "POST", url: "/v1/bot/verify-identity",
    payload: { telegramBotId: 123456 },
  });
  assert.equal(response.statusCode, 401);
});
