const DAY_MS = 86_400_000;

/** Round a competition kickoff up to the next whole Tehran-local hour. */
export function roundCompetitionKickoffToTehranHour(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const localHour = fields.hour ?? 0;
  const hasRemainder = (fields.minute ?? 0) > 0 || (fields.second ?? 0) > 0 || value.getUTCMilliseconds() > 0;
  const currentLocalAsUtc = Date.UTC(
    fields.year!, fields.month! - 1, fields.day!, localHour,
    fields.minute ?? 0, fields.second ?? 0, value.getUTCMilliseconds(),
  );
  const offsetMs = currentLocalAsUtc - value.getTime();
  const roundedLocalAsUtc = Date.UTC(
    fields.year!, fields.month! - 1, fields.day!, localHour + (hasRemainder ? 1 : 0), 0, 0, 0,
  );
  return new Date(roundedLocalAsUtc - offsetMs);
}

export function competitionKickoffAfterDays(now: Date, days: number): Date {
  return roundCompetitionKickoffToTehranHour(new Date(now.getTime() + days * DAY_MS));
}
