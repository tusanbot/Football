export function isValidTelegramBotToken(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token);
}

export function parseAdminTelegramIds(value: string | undefined): string[] {
  const ids = (value ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 && ids.every((id) => /^\d{1,20}$/.test(id) && BigInt(id) > 0n)
    ? [...new Set(ids)]
    : [];
}

/** Parse a strict comma-separated CORS allowlist. Wildcards and URL paths are never valid origins. */
export function parseCorsOrigins(value: string | undefined, production = process.env.NODE_ENV === "production"): string[] {
  const entries = (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  const origins = entries.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("CORS_ORIGINS contains an invalid origin.");
    }
    if (parsed.origin !== origin || parsed.username || parsed.password
      || !["http:", "https:"].includes(parsed.protocol)
      || (production && parsed.protocol !== "https:")
      || parsed.hostname === "*" || origin === "null") {
      throw new Error("CORS_ORIGINS must contain exact HTTP(S) origins; production origins must use HTTPS.");
    }
    return parsed.origin;
  });
  return [...new Set(origins)];
}
