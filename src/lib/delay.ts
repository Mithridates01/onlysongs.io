// The unlock delay. While the blocker is on, changes that let more through wait
// an hour, so turning it off in a moment of temptation doesn't stick. Changes
// that block more apply at once. Pure, so the browser can use it too.
import { toMinutes, type QuietHours } from "./quiet-hours";

export const DELAY_MS = 60 * 60 * 1000;

const DAY_MINUTES = 24 * 60;

function allows(window: QuietHours, minute: number): boolean {
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

// True when `to` allows a minute of the day that `from` doesn't.
export function widens(from: QuietHours | null, to: QuietHours | null): boolean {
  if (!to) return false;
  if (!from) return true;
  for (let minute = 0; minute < DAY_MINUTES; minute++) {
    if (allows(to, minute) && !allows(from, minute)) return true;
  }
  return false;
}

export function isDue(at: Date | null | undefined, now: Date): boolean {
  return Boolean(at && at <= now);
}
