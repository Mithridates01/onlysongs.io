// Daily counts of emails sent and failed, kept in Redis for a week so the
// admin page can show a mail outage. Counting never blocks or breaks a send.
import { dayKey } from "./day";

const KEEP_SECONDS = 8 * 24 * 60 * 60;

function key(ok: boolean, day: string): string {
  return `mail:${ok ? "sent" : "failed"}:${day}`;
}

export async function recordEmail(ok: boolean, now = new Date()): Promise<void> {
  if (!process.env.REDIS_URL) return;
  try {
    const { getRedis } = await import("./redis");
    const name = key(ok, dayKey(now));
    await getRedis().multi().incr(name).expire(name, KEEP_SECONDS).exec();
  } catch {
    // A missed tally is fine; the email outcome is still logged.
  }
}

// Totals over the last `days` UTC days, today included.
export async function readEmailCounts(days = 7, now = new Date()): Promise<{ sent: number; failed: number } | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    const { getRedis } = await import("./redis");
    const keys: string[] = [];
    for (let i = 0; i < days; i++) {
      const day = dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000));
      keys.push(key(true, day), key(false, day));
    }
    const values = await getRedis().mget(keys);
    let sent = 0;
    let failed = 0;
    values.forEach((value, i) => {
      if (i % 2 === 0) sent += Number(value ?? 0);
      else failed += Number(value ?? 0);
    });
    return { sent, failed };
  } catch {
    return null;
  }
}
