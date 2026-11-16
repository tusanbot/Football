export async function readResponseWithinLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error("TELEGRAM_FILE_DOWNLOAD_FAILED");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("INVALID_FILE_SIZE_LIMIT");

  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new Error("FILE_TOO_LARGE");
  }
  if (!response.body) throw new Error("TELEGRAM_FILE_BODY_MISSING");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("FILE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
