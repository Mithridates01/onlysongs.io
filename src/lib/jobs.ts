import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "./db";
import { log } from "./log";

export const QUEUE_NAME = "playback-checks";
const HEARTBEAT_KEY = "worker:heartbeat";

type RedisGlobal = typeof globalThis & { __blockerRedis?: IORedis };

function redisUrl(): string {
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new Error("REDIS_URL is not set");
  return url;
}

export function redisConnection() {
  return { url: redisUrl(), maxRetriesPerRequest: null as null };
}

export function getRedis(): IORedis {
  const g = globalThis as RedisGlobal;
  if (!g.__blockerRedis) {
    const client = new IORedis(redisUrl(), {
      maxRetriesPerRequest: 2,
      connectTimeout: 2000,
      retryStrategy(times) {
        if (times > 8) return null;
        return Math.min(times * 150, 1000);
      },
    });
    client.on("error", (error) => {
      log.error("redis error", { message: error.message });
    });
    g.__blockerRedis = client;
  }
  return g.__blockerRedis;
}

let queue: Queue | null = null;

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
  }
  return queue;
}

export function schedulerId(userId: string): string {
  return `blocker-${userId}`;
}

function everyMs(intervalSeconds: number): number {
  return Math.max(10, intervalSeconds) * 1000;
}

export async function scheduleUser(userId: string, intervalSeconds: number): Promise<void> {
  await getQueue().upsertJobScheduler(
    schedulerId(userId),
    { every: everyMs(intervalSeconds) },
    {
      name: "check",
      data: { userId },
      opts: { removeOnComplete: 50, removeOnFail: 50 },
    },
  );
}

export async function removeSchedule(userId: string): Promise<void> {
  await getQueue().removeJobScheduler(schedulerId(userId));
}

export async function enqueueCheck(userId: string): Promise<void> {
  await getQueue().add(
    "check",
    { userId },
    { removeOnComplete: 50, removeOnFail: 50, jobId: `now-${userId}-${Date.now()}` },
  );
}

// At startup every schedule is rewritten. The periodic run only restores
// schedules that are missing or have the wrong interval, for example after a
// Redis blip while a user turned the blocker on.
export async function reconcileSchedules(opts?: { onlyMissing?: boolean }): Promise<void> {
  const enabled = await prisma.blockerSettings.findMany({
    where: { enabled: true },
    select: { userId: true, intervalSeconds: true },
  });
  const keep = new Set(enabled.map((settings) => schedulerId(settings.userId)));
  const current = new Map<string, number | undefined>();
  let listed = false;
  try {
    const existing = await getQueue().getJobSchedulers();
    listed = true;
    for (const job of existing) {
      const id = job.id ?? job.key;
      if (!id) continue;
      if (!keep.has(id)) await getQueue().removeJobScheduler(id);
      else current.set(id, job.every == null ? undefined : Number(job.every));
    }
  } catch (error) {
    log.error("could not list schedules", { message: error instanceof Error ? error.message : "unknown" });
  }
  let restored = 0;
  for (const settings of enabled) {
    if (opts?.onlyMissing && listed && current.get(schedulerId(settings.userId)) === everyMs(settings.intervalSeconds)) {
      continue;
    }
    try {
      await scheduleUser(settings.userId, settings.intervalSeconds);
      restored++;
    } catch (error) {
      log.error("could not restore schedule", {
        userId: settings.userId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  if (!opts?.onlyMissing || restored > 0) log.info("schedules reconciled", { users: enabled.length, restored });
}

export async function trySchedule(userId: string, intervalSeconds: number, immediate: boolean): Promise<string | null> {
  try {
    await scheduleUser(userId, intervalSeconds);
    if (immediate) await enqueueCheck(userId);
    return null;
  } catch (error) {
    log.error("schedule failed", { message: error instanceof Error ? error.message : "unknown" });
    return "Redis is not running, so automatic checks will not start.";
  }
}

export async function tryUnschedule(userId: string): Promise<void> {
  try {
    await removeSchedule(userId);
  } catch (error) {
    log.error("unschedule failed", { message: error instanceof Error ? error.message : "unknown" });
  }
}

export async function pruneOldActivity(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const result = await prisma.activityLog.deleteMany({ where: { at: { lt: cutoff } } });
  return result.count;
}

export const CHECK_LOCK_MS = 12_000;
// Longer than the 25s refresh timeout in accounts.ts, so the lock outlives the refresh.
const REFRESH_LOCK_MS = 30_000;
const REFRESH_WAIT_MS = 8_000;

// Deletes the lock only while it still holds this caller's token, so a check
// that outlived its TTL cannot release a lock another check now owns.
const RELEASE_LOCK = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const acquired = await getRedis().set(key, token, "PX", ttlMs, "NX");
  return acquired === "OK" ? token : null;
}

async function releaseLock(key: string, token: string): Promise<void> {
  await getRedis()
    .eval(RELEASE_LOCK, 1, key, token)
    .catch(() => undefined);
}

export async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T | { busy: true }> {
  const key = `lock:check:${userId}`;
  const token = await acquireLock(key, CHECK_LOCK_MS);
  if (!token) return { busy: true };
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}

// Waits for another process's refresh to finish instead of racing it.
export async function withRefreshLock<T>(userId: string, fn: () => Promise<T>): Promise<T | { busy: true }> {
  const key = `lock:refresh:${userId}`;
  const deadline = Date.now() + REFRESH_WAIT_MS;
  for (;;) {
    const token = await acquireLock(key, REFRESH_LOCK_MS);
    if (token) {
      try {
        return await fn();
      } finally {
        await releaseLock(key, token);
      }
    }
    if (Date.now() >= deadline) return { busy: true };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export type NotifyKind = "broken" | "quota";

// Mail goes through the queue so an SMTP stall never runs inside a check lock.
export async function enqueueNotify(email: string, kind: NotifyKind): Promise<void> {
  if (!email) return;
  try {
    await getQueue().add(
      "notify",
      { email, kind },
      { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 50, removeOnFail: 50 },
    );
  } catch (error) {
    log.error("could not queue email", { kind, message: error instanceof Error ? error.message : "unknown" });
  }
}

export async function beatWorkerHeart(): Promise<void> {
  await getRedis().set(HEARTBEAT_KEY, new Date().toISOString(), "EX", 30);
}

export async function closeConnections(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  const g = globalThis as RedisGlobal;
  const client = g.__blockerRedis;
  if (!client) return;
  g.__blockerRedis = undefined;
  await client.quit();
}

export async function readWorkerHeart(): Promise<{ online: boolean; heartbeatAt: string | null }> {
  try {
    const value = await getRedis().get(HEARTBEAT_KEY);
    if (!value) return { online: false, heartbeatAt: null };
    const at = new Date(value);
    const online = Date.now() - at.getTime() < 35_000;
    return { online, heartbeatAt: value };
  } catch {
    return { online: false, heartbeatAt: null };
  }
}
