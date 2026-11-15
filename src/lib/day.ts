export const DAY_MS = 24 * 60 * 60 * 1000;

// The UTC date, as YYYY-MM-DD.
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}
