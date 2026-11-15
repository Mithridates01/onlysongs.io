import { afterEach, describe, expect, it } from "vitest";
import { loadRetention, loadSwapSeries, loadTopShows } from "../../src/lib/admin-metrics";
import { dayKey } from "../../src/lib/day";
import { prisma } from "../../src/lib/db";
import { deleteUser, seedListener } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("admin metrics queries", () => {
  const created: string[] = [];
  afterEach(async () => {
    while (created.length) await deleteUser(created.pop()!);
  });

  async function user() {
    const seeded = await seedListener();
    created.push(seeded.id);
    return seeded;
  }

  it("counts swaps per UTC day and leaves out other results", async () => {
    const before = await loadSwapSeries(7);
    const u = await user();
    const yesterday = new Date(Date.now() - DAY_MS);
    await prisma.activityLog.createMany({
      data: [
        { userId: u.id, action: "swap", result: "replaced", at: yesterday },
        { userId: u.id, action: "fallback_next", result: "replaced_via_next", at: yesterday },
        { userId: u.id, action: "swap", result: "replaced" },
        { userId: u.id, action: "error", result: "failed" },
      ],
    });
    const after = await loadSwapSeries(7);
    expect(after).toHaveLength(7);
    expect(after.at(-1)?.day).toBe(dayKey(new Date()));
    expect(after.at(-1)!.swaps - before.at(-1)!.swaps).toBe(1);
    expect(after.at(-2)!.swaps - before.at(-2)!.swaps).toBe(2);
  });

  it("ranks the most swapped shows", async () => {
    const u = await user();
    const show = `Metrics Show ${u.id}`;
    await prisma.activityLog.createMany({
      data: Array.from({ length: 40 }, () => ({ userId: u.id, action: "swap" as const, result: "replaced" as const, showName: show })),
    });
    expect((await loadTopShows())[0]).toEqual({ show, swaps: 40 });
  });

  it("counts who came back a week after signing up", async () => {
    const before = await loadRetention();
    const returned = await user();
    const gone = await user();
    const signedUp = new Date(Date.now() - 20 * DAY_MS);
    await prisma.user.updateMany({ where: { id: { in: [returned.id, gone.id] } }, data: { createdAt: signedUp } });
    await prisma.userActivityDay.deleteMany({ where: { userId: { in: [returned.id, gone.id] } } });
    await prisma.userActivityDay.createMany({
      data: [
        { userId: returned.id, day: new Date(`${dayKey(new Date(Date.now() - 3 * DAY_MS))}T00:00:00Z`) },
        { userId: gone.id, day: new Date(`${dayKey(signedUp)}T00:00:00Z`) },
      ],
    });
    const after = await loadRetention();
    expect((after.cameBack?.eligible ?? 0) - (before.cameBack?.eligible ?? 0)).toBe(2);
    expect((after.cameBack?.returned ?? 0) - (before.cameBack?.returned ?? 0)).toBe(1);
    expect(after.weekly - before.weekly).toBe(1);
  });
});
