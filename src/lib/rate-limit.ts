import { getRedis } from "./jobs";
import { log } from "./log";

export type Limit = { key: string; limit: number; windowMs: number };

// Fixed-window counters in Redis, so limits survive restarts and are shared by
// every web replica. If Redis is unreachable the request is allowed and logged:
// an outage should not lock everyone out.
export async function rateLimit(...limits: Limit[]): Promise<{ ok: boolean; retryAfterSec: number }> {
  try {
    const redis = getRedis();
    let retryAfterSec = 0;
    for (const { key, limit, windowMs } of limits) {
      const name = `rl:${key}`;
      const result = await redis.multi().incr(name).pttl(name).exec();
      const count = Number(result?.[0]?.[1] ?? 0);
      let ttl = Number(result?.[1]?.[1] ?? -1);
      if (ttl < 0) {
        await redis.pexpire(name, windowMs);
        ttl = windowMs;
      }
      if (count > limit) retryAfterSec = Math.max(retryAfterSec, Math.ceil(ttl / 1000));
    }
    return { ok: retryAfterSec === 0, retryAfterSec };
  } catch (error) {
    log.error("rate limit unavailable", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: true, retryAfterSec: 0 };
  }
}

export function clientIp(header: string | null): string {
  if (!header) return "unknown";
  return header.split(",")[0]?.trim() || "unknown";
}

export const MINUTE = 60 * 1000;
