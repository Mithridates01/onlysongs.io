import { prisma } from "./db";
import { SESSION_DAYS, readSession, signSession, type SessionPayload } from "./session";

// lastSeenAt is a hint for the account page, so it is written at most this often.
const TOUCH_EVERY_MS = 10 * 60 * 1000;

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
  return signSession({ sub: user.id, sid: session.id, email: user.email, admin: user.isAdmin });
}

// Verifies the JWT and that its session row is still live.
export async function liveSession(token: string | undefined | null): Promise<SessionPayload | null> {
  const payload = await readSession(token);
  if (!payload) return null;
  const row = await prisma.session.findUnique({ where: { id: payload.sid } });
  const now = Date.now();
  if (!row || row.userId !== payload.sub || row.revokedAt || row.expiresAt.getTime() <= now) return null;
  if (now - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
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
