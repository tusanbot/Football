import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("club logo mutations require Telegram authentication", async (t) => {
  const app = buildApp();
  await app.ready();
  t.after(async () => app.close());
  const responses = await Promise.all([
    app.inject({ method: "PUT", url: "/v1/club/logo", payload: { mimeType: "image/png", base64: "iVBORw0KGgo=" } }),
    app.inject({ method: "DELETE", url: "/v1/club/logo" }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [401, 401]);
});
