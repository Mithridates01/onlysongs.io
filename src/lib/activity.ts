import { prisma } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function pruneOldActivity(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * DAY_MS);
  const result = await prisma.activityLog.deleteMany({ where: { at: { lt: cutoff } } });
  return result.count;
}

// Rows that have stopped mattering. Ended sessions and spent or expired email
// links are kept a week for troubleshooting; active-day rows about 13 months.
export async function pruneStale(now = new Date()): Promise<Record<string, number>> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [activity, sessions, tokens, days] = await Promise.all([
    pruneOldActivity(now),
    prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }] } }),
    prisma.authToken.deleteMany({ where: { OR: [{ usedAt: { lt: weekAgo } }, { expiresAt: { lt: weekAgo } }] } }),
    prisma.userActivityDay.deleteMany({ where: { day: { lt: new Date(now.getTime() - 400 * DAY_MS) } } }),
  ]);
  return { activity, sessions: sessions.count, authTokens: tokens.count, activeDays: days.count };
}
