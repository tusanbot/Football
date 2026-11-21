import { createHmac, timingSafeEqual } from "node:crypto";

export const TELEGRAM_SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface TelegramSessionClaims {
  telegramId: string;
  issuedAt: number;
  expiresAt: number;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createTelegramSessionToken(telegramId: string, secret: string, now = new Date()): { token: string; expiresAt: string } {
  if (!/^\d{1,20}$/.test(telegramId) || BigInt(telegramId) <= 0n || secret.length < 32) throw new Error("INVALID_SESSION_CONFIGURATION");
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + TELEGRAM_SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ sub: telegramId, iat: issuedAt, exp: expiresAt })).toString("base64url");
  return { token: payload + "." + signature(payload, secret), expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export function verifyTelegramSessionToken(token: string, secret: string, now = new Date()): TelegramSessionClaims | null {
  if (secret.length < 32 || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) return null;
  const expected = Buffer.from(signature(parts[0]!, secret));
  const actual = Buffer.from(parts[1]!);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")); } catch { return null; }
  if (!payload || typeof payload !== "object") return null;
  const claims = payload as { sub?: unknown; iat?: unknown; exp?: unknown };
  if (typeof claims.sub !== "string" || !/^\d{1,20}$/.test(claims.sub) || BigInt(claims.sub) <= 0n
    || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) return null;
  const issuedAt = claims.iat as number;
  const expiresAt = claims.exp as number;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (issuedAt > nowSeconds + 30 || expiresAt <= nowSeconds
    || expiresAt <= issuedAt || expiresAt - issuedAt > TELEGRAM_SESSION_TTL_SECONDS) return null;
  return { telegramId: claims.sub, issuedAt, expiresAt };
}
