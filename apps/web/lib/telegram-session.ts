export async function createTelegramSession(apiBaseUrl: string, initData: string): Promise<string> {
  const response = await fetch(apiBaseUrl + "/v1/auth/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  const payload = await response.json().catch(() => ({})) as { sessionToken?: string; error?: string };
  if (!response.ok || typeof payload.sessionToken !== "string" || payload.sessionToken.length < 40) {
    throw new Error(payload.error ?? "احراز هویت تلگرام ناموفق بود.");
  }
  return payload.sessionToken;
}
