import { prisma } from "./db";

export type DayPoint = { day: string; total: number; joined: number; active: number };

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

// One point per UTC day, oldest first, ending today. total = accounts that
// existed at the end of that day; joined = accounts created that day;
// active = users who signed in or used the site that day.
export function buildSeries(opts: {
  days: number;
  now: Date;
  before: number;
  joinedByDay: Map<string, number>;
  activeByDay: Map<string, number>;
}): DayPoint[] {
  const today = Date.UTC(opts.now.getUTCFullYear(), opts.now.getUTCMonth(), opts.now.getUTCDate());
  const points: DayPoint[] = [];
  let total = opts.before;
  for (let i = opts.days - 1; i >= 0; i--) {
    const day = dayKey(new Date(today - i * DAY_MS));
    const joined = opts.joinedByDay.get(day) ?? 0;
    total += joined;
    points.push({ day, total, joined, active: opts.activeByDay.get(day) ?? 0 });
  }
  return points;
}

export async function loadSeries(days = 90, now = new Date()): Promise<DayPoint[]> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY_MS);
  const [before, joined, active] = await Promise.all([
    prisma.user.count({ where: { createdAt: { lt: start } } }),
    prisma.user.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true } }),
    prisma.userActivityDay.groupBy({ by: ["day"], where: { day: { gte: start } }, _count: { _all: true } }),
  ]);
  const joinedByDay = new Map<string, number>();
  for (const user of joined) {
    const key = dayKey(user.createdAt);
    joinedByDay.set(key, (joinedByDay.get(key) ?? 0) + 1);
  }
  const activeByDay = new Map(active.map((row) => [dayKey(row.day), row._count._all]));
  return buildSeries({ days, now, before, joinedByDay, activeByDay });
}
