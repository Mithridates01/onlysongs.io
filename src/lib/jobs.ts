// The BullMQ queue: per-user check schedules and notify jobs.
import { Queue } from "bullmq";
import { prisma } from "./db";
import { log } from "./log";
import { closeRedis, redisConnection } from "./redis";

export const QUEUE_NAME = "playback-checks";

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

export async function closeConnections(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  await closeRedis();
}
