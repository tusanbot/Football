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
  options: { maxAgeSeconds?: number; now?: Date } = {}
): VerifiedTelegramInitData {
  const maxAgeSeconds = options.maxAgeSeconds ?? 300;
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) throw new Error("Invalid Telegram initData hash");

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(receivedHash, "hex");
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new Error("Telegram initData signature verification failed");
  }

  const authDateValue = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDateValue) || authDateValue <= 0) throw new Error("Invalid Telegram auth_date");
  const age = nowSeconds - authDateValue;
  if (age < -30 || age > maxAgeSeconds) throw new Error("Telegram initData has expired");

  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Telegram user is missing from initData");
  let user: TelegramWebAppUser;
  try { user = JSON.parse(rawUser) as TelegramWebAppUser; }
  catch { throw new Error("Telegram user payload is invalid"); }
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== "string") {
    throw new Error("Telegram user payload is invalid");
  }

  const queryId = params.get("query_id") ?? undefined;
  return { user, authDate: new Date(authDateValue * 1000), ...(queryId ? { queryId } : {}) };
}
