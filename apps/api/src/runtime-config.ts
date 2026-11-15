export function isValidTelegramBotToken(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token);
}

export function parseAdminTelegramIds(value: string | undefined): string[] {
  const ids = (value ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 && ids.every((id) => /^\d{1,20}$/.test(id)) ? ids : [];
}
