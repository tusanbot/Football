import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface VerifiedTelegramInitData {
  user: TelegramWebAppUser;
  authDate: Date;
  queryId?: string;
}

/** Validate Telegram Mini App initData on the server. Never trust initDataUnsafe. */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: Date } = {},
): VerifiedTelegramInitData {
  if (typeof initData !== "string" || initData.length === 0 || initData.length > 8192) {
    throw new Error("Invalid Telegram initData size");
  }
  if (typeof botToken !== "string" || !/^\\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    throw new Error("Invalid Telegram bot token");
  }
  const maxAgeSeconds = options.maxAgeSeconds ?? 300;
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 3600) {
    throw new Error("Invalid Telegram initData age policy");
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const params = new URLSearchParams(initData);
  const seen = new Set<string>();
  for (const [key] of params) {
    if (seen.has(key)) throw new Error("Duplicate Telegram initData field");
    seen.add(key);
  }
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) throw new Error("Invalid Telegram initData hash");

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(receivedHash, "hex");
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new Error("Telegram initData signature verification failed");
  }

  const rawAuthDate = params.get("auth_date");
  if (!rawAuthDate || !/^\\d{1,12}$/.test(rawAuthDate)) throw new Error("Invalid Telegram auth_date");
  const authDateValue = Number(rawAuthDate);
  if (!Number.isSafeInteger(authDateValue) || authDateValue <= 0) throw new Error("Invalid Telegram auth_date");
  const age = nowSeconds - authDateValue;
  if (age < -30 || age > maxAgeSeconds) throw new Error("Telegram initData has expired");

  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Telegram user is missing from initData");
  let candidate: unknown;
  try { candidate = JSON.parse(rawUser); }
  catch { throw new Error("Telegram user payload is invalid"); }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Telegram user payload is invalid");
  }
  const user = candidate as Record<string, unknown>;
  if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0
    || typeof user.first_name !== "string" || !user.first_name.trim() || user.first_name.length > 256
    || (user.last_name !== undefined && (typeof user.last_name !== "string" || user.last_name.length > 256))
    || (user.username !== undefined && (typeof user.username !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(user.username)))
    || (user.language_code !== undefined && (typeof user.language_code !== "string" || user.language_code.length > 35))
    || (user.is_premium !== undefined && typeof user.is_premium !== "boolean")) {
    throw new Error("Telegram user payload is invalid");
  }

  const queryId = params.get("query_id") ?? undefined;
  if (queryId !== undefined && (queryId.length === 0 || queryId.length > 256)) {
    throw new Error("Invalid Telegram query_id");
  }
  return {
    user: user as unknown as TelegramWebAppUser,
    authDate: new Date(authDateValue * 1000),
    ...(queryId ? { queryId } : {}),
  };
}
