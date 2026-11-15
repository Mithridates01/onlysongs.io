// Numbers for the admin page beyond the account and active-user charts: how the
// service is running, whether the blocker is doing its job, and who comes back.
// Only totals across accounts; nothing here is one person's listening.
import { FAILURE_WARN_AT } from "./blocker-logic";
import { DAY_MS, dayKey } from "./day";
import { prisma } from "./db";

export type SwapPoint = { day: string; swaps: number };

export type Health = {
  blockersOn: number;
  behind: number;
  failing: number;
  broken: number;
  paused: number;
  errors24h: number;
  rateLimited24h: number;
};

type PollRow = {
  enabled: boolean;
  intervalSeconds: number;
  status: string | null;
  lastCheckedAt: Date | null;
  consecutiveFailures: number;
  pausedUntil: Date | null;
};

// Accounts whose blocker should be checking but hasn't been, using the same
// allowance as the account page: three missed intervals plus a minute.
export function countHealth(rows: PollRow[], now: Date): Omit<Health, "errors24h" | "rateLimited24h"> {
  let blockersOn = 0;
  let behind = 0;
  let failing = 0;
  let broken = 0;
  let paused = 0;
  for (const row of rows) {
    const isPaused = Boolean(row.pausedUntil && row.pausedUntil > now);
    if (isPaused) paused += 1;
    if (row.status === "broken") broken += 1;
    if (row.consecutiveFailures >= FAILURE_WARN_AT) failing += 1;
    if (!row.enabled) continue;
    blockersOn += 1;
    if (row.status !== "connected" || isPaused) continue;
    const staleAfterMs = row.intervalSeconds * 3 * 1000 + 60_000;
    if (!row.lastCheckedAt || now.getTime() - row.lastCheckedAt.getTime() > staleAfterMs) behind += 1;
  }
  return { blockersOn, behind, failing, broken, paused };
}

export async function loadHealth(now = new Date()): Promise<Health> {
  const since = new Date(now.getTime() - DAY_MS);
  const [rows, errors, rateLimited] = await Promise.all([
    prisma.blockerSettings.findMany({
      select: {
        enabled: true,
        intervalSeconds: true,
        user: { select: { spotify: { select: { status: true } }, poll: { select: { lastCheckedAt: true, consecutiveFailures: true, pausedUntil: true } } } },
      },
    }),
    prisma.activityLog.count({ where: { at: { gte: since }, action: "error" } }),
    prisma.activityLog.count({ where: { at: { gte: since }, result: { in: ["rate_limited", "quota"] } } }),
  ]);
  const counts = countHealth(
    rows.map((row) => ({
      enabled: row.enabled,
      intervalSeconds: row.intervalSeconds,
      status: row.user.spotify?.status ?? null,
      lastCheckedAt: row.user.poll?.lastCheckedAt ?? null,
      consecutiveFailures: row.user.poll?.consecutiveFailures ?? 0,
      pausedUntil: row.user.poll?.pausedUntil ?? null,
    })),
    now,
  );
  return { ...counts, errors24h: errors, rateLimited24h: rateLimited };
}

const SWAPPED = ["replaced", "replaced_via_next"] as const;

// Podcasts swapped per UTC day, oldest first, ending today. Activity is kept
// 90 days, so that's the longest useful range.
export async function loadSwapSeries(days = 90, now = new Date()): Promise<SwapPoint[]> {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = new Date(today - (days - 1) * DAY_MS);
  const rows = await prisma.$queryRaw<{ day: Date; swaps: bigint }[]>`
    SELECT date_trunc('day', "at" AT TIME ZONE 'UTC') AS day, count(*) AS swaps
    FROM activity_log
    WHERE "at" >= ${start} AND result::text IN ('replaced', 'replaced_via_next')
    GROUP BY 1`;
  const byDay = new Map(rows.map((row) => [dayKey(row.day), Number(row.swaps)]));
  const points: SwapPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(new Date(today - i * DAY_MS));
    points.push({ day, swaps: byDay.get(day) ?? 0 });
  }
  return points;
}

// The shows swapped most in the last 30 days, across everyone.
export async function loadTopShows(limit = 8, now = new Date()): Promise<{ show: string; swaps: number }[]> {
  const rows = await prisma.activityLog.groupBy({
    by: ["showName"],
    where: { at: { gte: new Date(now.getTime() - 30 * DAY_MS) }, result: { in: [...SWAPPED] }, showName: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { showName: "desc" } },
    take: limit,
  });
  return rows.map((row) => ({ show: row.showName ?? "", swaps: row._count._all }));
}

export type Retention = {
  weekly: number;
  monthly: number;
  // Of accounts at least 8 days old (and under 90), how many used the site
  // again a week or more after signing up. null when there are none yet.
  cameBack: { returned: number; eligible: number } | null;
};

export async function loadRetention(now = new Date()): Promise<Retention> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
  const [weekly, monthly, cohort] = await Promise.all([
    prisma.userActivityDay.findMany({ where: { day: { gte: weekAgo } }, distinct: ["userId"], select: { userId: true } }),
    prisma.userActivityDay.findMany({ where: { day: { gte: monthAgo } }, distinct: ["userId"], select: { userId: true } }),
    prisma.$queryRaw<{ eligible: bigint; returned: bigint }[]>`
      SELECT count(*) AS eligible,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM user_activity_days d
               WHERE d.user_id = u.id AND d.day >= (u.created_at AT TIME ZONE 'UTC')::date + 7
             )) AS returned
      FROM users u
      WHERE u.created_at <= ${new Date(now.getTime() - 8 * DAY_MS)}
        AND u.created_at > ${new Date(now.getTime() - 90 * DAY_MS)}`,
  ]);
  const eligible = Number(cohort[0]?.eligible ?? 0);
  return {
    weekly: weekly.length,
    monthly: monthly.length,
    cameBack: eligible ? { returned: Number(cohort[0]?.returned ?? 0), eligible } : null,
  };
}

export type EarlyAccessStats = {
  waiting: number;
  oldestWaitDays: number | null;
  medianApproveHours: number | null;
  invited: number;
  joined: number;
  expired: number;
};

export function earlyAccessStats(
  rows: { status: string; createdAt: Date; decidedAt: Date | null; inviteExpiresAt: Date | null }[],
  now: Date,
): EarlyAccessStats {
  const pending = rows.filter((row) => row.status === "pending");
  const oldest = pending.reduce<Date | null>((min, row) => (!min || row.createdAt < min ? row.createdAt : min), null);
  const waits = rows
    .filter((row) => (row.status === "invited" || row.status === "joined") && row.decidedAt)
    .map((row) => (row.decidedAt!.getTime() - row.createdAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  const mid = Math.floor(waits.length / 2);
  const median = waits.length === 0 ? null : waits.length % 2 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2;
  const invitedRows = rows.filter((row) => row.status === "invited");
  const expired = invitedRows.filter((row) => row.inviteExpiresAt && row.inviteExpiresAt <= now).length;
  const joined = rows.filter((row) => row.status === "joined").length;
  return {
    waiting: pending.length,
    oldestWaitDays: oldest ? Math.floor((now.getTime() - oldest.getTime()) / DAY_MS) : null,
    medianApproveHours: median === null ? null : Math.round(median),
    invited: invitedRows.length + joined,
    joined,
    expired,
  };
}
