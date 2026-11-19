type CachedSession = { token: string; expiresAt: number };
const SESSION_STORAGE_KEY = "football-empire.session.v1";
let memorySession: CachedSession | null = null;

function readCachedSession(): CachedSession | null {
  if (memorySession && memorySession.expiresAt > Date.now() + 30_000) return memorySession;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number"
      || parsed.expiresAt <= Date.now() + 30_000) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    memorySession = { token: parsed.token, expiresAt: parsed.expiresAt };
    return memorySession;
  } catch {
    return null;
  }
}

function storeSession(session: CachedSession) {
  memorySession = session;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // In-memory session remains available when storage is disabled by the WebView.
  }
}

function clearSession() {
  memorySession = null;
  try { window.sessionStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
}

export async function createTelegramSession(apiBaseUrl: string, initData: string): Promise<string> {
  const cached = readCachedSession();
  if (cached) {
    try {
      const validation = await fetch(apiBaseUrl + "/v1/me", {
        headers: { authorization: "Bearer " + cached.token },
      });
      if (validation.ok) return cached.token;
      if (validation.status !== 401 && validation.status !== 403) return cached.token;
    } catch {
      return cached.token;
    }
    clearSession();
  }

  const response = await fetch(apiBaseUrl + "/v1/auth/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  const payload = await response.json().catch(() => ({})) as {
    sessionToken?: string;
    sessionExpiresAt?: string;
    error?: string;
  };
  const expiresAt = typeof payload.sessionExpiresAt === "string" ? Date.parse(payload.sessionExpiresAt) : NaN;
  if (!response.ok || typeof payload.sessionToken !== "string" || payload.sessionToken.length < 40
    || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000) {
    throw new Error(payload.error ?? "احراز هویت تلگرام ناموفق بود؛ بازی را دوباره از داخل تلگرام باز کنید.");
  }
  storeSession({ token: payload.sessionToken, expiresAt });
  return payload.sessionToken;
}
