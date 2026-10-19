import { prisma } from "./db";
import { SESSION_DAYS, readSession, signSession, type SessionPayload } from "./session";

// lastSeenAt is a hint for the account page, so it is written at most this often.
const TOUCH_EVERY_MS = 10 * 60 * 1000;

function utcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

// Counts the user as active today (UTC) for the operator's daily-active chart.
// Idempotent, and never allowed to fail the request it rides on.
export async function recordActiveDay(userId: string, at = new Date()): Promise<void> {
  await prisma.userActivityDay
    .upsert({
      where: { userId_day: { userId, day: utcDay(at) } },
      create: { userId, day: utcDay(at) },
      update: {},
    })
    .catch(() => undefined);
}

export async function startSession(
  user: { id: string; email: string; isAdmin: boolean },
  userAgent?: string | null,
): Promise<string> {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  });
  await recordActiveDay(user.id);
  return signSession({ sub: user.id, sid: session.id, email: user.email, admin: user.isAdmin });
}

// Verifies the JWT and that its session row is still live.
export async function liveSession(token: string | undefined | null): Promise<SessionPayload | null> {
  const payload = await readSession(token);
  if (!payload) return null;
  const row = await prisma.session.findUnique({ where: { id: payload.sid } });
  const now = Date.now();
  if (!row || row.userId !== payload.sub || row.revokedAt || row.expiresAt.getTime() <= now) return null;
  const newDay = utcDay(row.lastSeenAt).getTime() !== utcDay(new Date(now)).getTime();
  if (newDay || now - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
    // The first visit on a new day; repeat visits that day skip this.
    if (newDay) await recordActiveDay(row.userId, new Date(now));
  }
  return payload;
}

export async function revokeSession(sid: string): Promise<void> {
  await prisma.session.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
}

// Ends every session for the user, optionally keeping the caller's own.
export async function revokeUserSessions(userId: string, keepSid?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(keepSid ? { id: { not: keepSid } } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
