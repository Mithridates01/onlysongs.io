export type QuietHours = {
  start: string;
  end: string;
  timeZone?: string;
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClock(value: string): boolean {
  return CLOCK.test(value);
}

export function normalizeClock(value: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

export function toMinutes(value: string): number {
  const match = CLOCK.exec(value);
  if (!match) throw new Error("expected HH:MM");
  return Number(match[1]) * 60 + Number(match[2]);
}

export function zoneParts(now: Date, timeZone: string): { hour: number; minute: number; year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return asUtc - date.getTime();
}

export function isQuietNow(
  quiet: QuietHours | null | undefined,
  timeZone: string,
  now = new Date(),
): boolean {
  if (!quiet?.start || !quiet.end) return false;
  if (!isClock(quiet.start) || !isClock(quiet.end)) return false;
  if (quiet.start === quiet.end) return false;
  const zone = quiet.timeZone || timeZone || "UTC";
  const current = zoneParts(now, zone);
  const cur = current.hour * 60 + current.minute;
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

export function startOfZonedDay(timeZone: string, now = new Date()): Date {
  const parts = zoneParts(now, timeZone);
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0));
  const offset = zoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset);
}

export function parseQuietHours(value: unknown): QuietHours | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.start !== "string" || typeof record.end !== "string") return null;
  if (!isClock(record.start) || !isClock(record.end)) return null;
  return {
    start: record.start,
    end: record.end,
    timeZone: typeof record.timeZone === "string" ? record.timeZone : undefined,
  };
}
