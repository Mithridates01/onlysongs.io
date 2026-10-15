// Redis client, per-user locks, and the worker heartbeat.
import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import { log } from "./log";

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
  // A client that was quit (or closed by an older build) is replaced, never reused.
  if (!g.__blockerRedis || g.__blockerRedis.status === "end") {
    const client = new IORedis(redisUrl(), {
      maxRetriesPerRequest: 2,
      connectTimeout: 2000,
      // Keep reconnecting through an outage of any length. Commands still fail
      // fast (maxRetriesPerRequest) while it is down.
      retryStrategy(times) {
        return Math.min(times * 200, 5000);
      },
    });
    client.on("error", (error) => {
      log.error("redis error", { message: error.message });
    });
    g.__blockerRedis = client;
  }
  return g.__blockerRedis;
}

export async function closeRedis(): Promise<void> {
  const g = globalThis as RedisGlobal;
  const client = g.__blockerRedis;
  if (!client) return;
  g.__blockerRedis = undefined;
  await client.quit();
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

export async function beatWorkerHeart(): Promise<void> {
  await getRedis().set(HEARTBEAT_KEY, new Date().toISOString(), "EX", 30);
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
