type Bucket = { count: number; reset: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  const existing = buckets.get(key);
  if (!existing || existing.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (existing.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((existing.reset - now) / 1000)) };
  }
  existing.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

export function clientIp(header: string | null): string {
  if (!header) return "unknown";
  return header.split(",")[0]?.trim() || "unknown";
}
