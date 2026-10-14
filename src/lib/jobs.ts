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

export async function scheduleUser(userId: string, intervalSeconds: number): Promise<void> {
  const every = Math.max(10, intervalSeconds) * 1000;
  await getQueue().upsertJobScheduler(
    schedulerId(userId),
    { every },
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

export async function reconcileSchedules(): Promise<void> {
  const enabled = await prisma.blockerSettings.findMany({
    where: { enabled: true },
    select: { userId: true, intervalSeconds: true },
  });
  const keep = new Set(enabled.map((settings) => schedulerId(settings.userId)));
  try {
    const existing = await getQueue().getJobSchedulers();
    for (const job of existing) {
      const id = job.id ?? job.key;
      if (id && !keep.has(id)) await getQueue().removeJobScheduler(id);
    }
  } catch (error) {
    log.error("could not list schedules", { message: error instanceof Error ? error.message : "unknown" });
  }
  for (const settings of enabled) {
    try {
      await scheduleUser(settings.userId, settings.intervalSeconds);
    } catch (error) {
      log.error("could not restore schedule", {
        userId: settings.userId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  log.info("schedules reconciled", { users: enabled.length });
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

export async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T | { busy: true }> {
  const redis = getRedis();
  const key = `lock:check:${userId}`;
  const acquired = await redis.set(key, "1", "PX", 12_000, "NX");
  if (acquired !== "OK") return { busy: true };
  try {
    return await fn();
  } finally {
    await redis.del(key).catch(() => undefined);
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
