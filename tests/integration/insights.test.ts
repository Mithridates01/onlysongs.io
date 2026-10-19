import { afterEach, describe, expect, it } from "vitest";
import { pruneStale } from "../../src/lib/activity";
import { dayKey, loadSeries } from "../../src/lib/admin-stats";
import { prisma } from "../../src/lib/db";
import { readSession } from "../../src/lib/session";
import { liveSession, startSession } from "../../src/lib/sessions";
import { deleteUser, seedListener } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(at: Date): Date {
  return new Date(`${dayKey(at)}T00:00:00Z`);
}

describe("daily active users and pruning", () => {
  const created: string[] = [];
  afterEach(async () => {
    while (created.length) await deleteUser(created.pop()!);
  });

  async function user() {
    const seeded = await seedListener();
    created.push(seeded.id);
    return { id: seeded.id, email: seeded.email, isAdmin: false };
  }

  it("counts a user once for the day they sign in", async () => {
    const u = await user();
    await startSession(u);
    await startSession(u);
    const days = await prisma.userActivityDay.findMany({ where: { userId: u.id } });
    expect(days.map((row) => dayKey(row.day))).toEqual([dayKey(new Date())]);
  });

  it("counts a returning visit on a new day, once", async () => {
    const u = await user();
    const token = await startSession(u);
    const sid = (await readSession(token))!.sid;
    await prisma.userActivityDay.deleteMany({ where: { userId: u.id } });
    await prisma.session.update({ where: { id: sid }, data: { lastSeenAt: new Date(Date.now() - DAY_MS) } });

    expect(await liveSession(token)).not.toBeNull();
    expect(await liveSession(token)).not.toBeNull();
    expect(await prisma.userActivityDay.count({ where: { userId: u.id } })).toBe(1);
  });

  it("feeds the admin series from accounts and active days", async () => {
    const u = await user();
    await startSession(u);
    const series = await loadSeries(7);
    const today = series.at(-1)!;
    expect(series).toHaveLength(7);
    expect(today.day).toBe(dayKey(new Date()));
    expect(today.active).toBeGreaterThanOrEqual(1);
    expect(today.total).toBe(await prisma.user.count());
  });

  it("prunes only stale sessions, spent links and very old active days", async () => {
    const u = await user();
    const live = await startSession(u);
    const liveSid = (await readSession(live))!.sid;
    const old = await prisma.session.create({
      data: { userId: u.id, expiresAt: new Date(Date.now() - 10 * DAY_MS) },
    });
    const spent = await prisma.authToken.create({
      data: { userId: u.id, purpose: "reset_password", tokenHash: `spent-${u.id}`, expiresAt: new Date(Date.now() - 9 * DAY_MS), usedAt: new Date(Date.now() - 9 * DAY_MS) },
    });
    const fresh = await prisma.authToken.create({
      data: { userId: u.id, purpose: "verify_email", tokenHash: `fresh-${u.id}`, expiresAt: new Date(Date.now() + DAY_MS) },
    });
    await prisma.userActivityDay.create({ data: { userId: u.id, day: utcDay(new Date(Date.now() - 500 * DAY_MS)) } });

    const counts = await pruneStale();
    expect(counts.sessions).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: liveSid } })).not.toBeNull();
    expect(await prisma.authToken.findUnique({ where: { id: spent.id } })).toBeNull();
    expect(await prisma.authToken.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await prisma.userActivityDay.count({ where: { userId: u.id } })).toBe(1);
  });
});
