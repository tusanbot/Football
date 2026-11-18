import assert from "node:assert/strict";
import test from "node:test";
import { readResponseWithinLimit } from "../src/telegram-file.js";

test("reads a Telegram file only while it remains within the byte limit", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const result = await readResponseWithinLimit(new Response(bytes), 4);
  assert.deepEqual([...result], [1, 2, 3, 4]);
});

test("rejects oversized streamed Telegram files even without Content-Length", async () => {
  const response = new Response(new Uint8Array(513));
  await assert.rejects(() => readResponseWithinLimit(response, 512), /FILE_TOO_LARGE/);
});

test("rejects oversized Telegram files from Content-Length before reading", async () => {
  const response = new Response(new Uint8Array([1]), { headers: { "content-length": "513" } });
  await assert.rejects(() => readResponseWithinLimit(response, 512), /FILE_TOO_LARGE/);
});

test("rejects unsuccessful Telegram downloads", async () => {
  const response = new Response("not found", { status: 404 });
  await assert.rejects(() => readResponseWithinLimit(response, 512), /TELEGRAM_FILE_DOWNLOAD_FAILED/);
});
