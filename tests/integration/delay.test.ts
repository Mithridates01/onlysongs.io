import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/db";
import { DELAY_MS } from "../../src/lib/delay";
import { getQueue, schedulerId } from "../../src/lib/jobs";
import { applySettings, settlePending } from "../../src/lib/settings";
import { deleteUser, seedListener } from "./helpers";

const created: string[] = [];

async function listener(opts?: Parameters<typeof seedListener>[0]) {
  const seeded = await seedListener(opts);
  created.push(seeded.id);
  return seeded.id;
}

const row = (userId: string) => prisma.blockerSettings.findUniqueOrThrow({ where: { userId } });

// Moves a waiting change's time into the past, as if the hour went by.
async function elapse(userId: string) {
  const past = new Date(Date.now() - 1000);
  const current = await row(userId);
  await prisma.blockerSettings.update({
    where: { userId },
    data: { offAt: current.offAt ? past : null, quietHoursAt: current.quietHoursAt ? past : null },
  });
}

describe("unlock delay", () => {
  afterEach(async () => {
    while (created.length) await deleteUser(created.pop()!);
  });

  it("turns the blocker off an hour after asking, not at once", async () => {
    const userId = await listener();
    const before = Date.now();
    expect(await applySettings(userId, { enabled: false })).toEqual({ ok: true });
    const waiting = await row(userId);
    expect(waiting.enabled).toBe(true);
    expect(waiting.offAt!.getTime()).toBeGreaterThanOrEqual(before + DELAY_MS);

    // Asking again doesn't push the time back.
    await applySettings(userId, { enabled: false });
    expect((await row(userId)).offAt).toEqual(waiting.offAt);

    await elapse(userId);
    const settled = await settlePending(await row(userId));
    expect(settled.enabled).toBe(false);
    expect(settled.offAt).toBeNull();
    const schedulers = await getQueue().getJobSchedulers();
    expect(schedulers.some((job) => (job.id ?? job.key) === schedulerId(userId))).toBe(false);
  });

  it("cancels a waiting turn-off when turned back on", async () => {
    const userId = await listener();
    await applySettings(userId, { enabled: false });
    await applySettings(userId, { enabled: true });
    const current = await row(userId);
    expect(current.enabled).toBe(true);
    expect(current.offAt).toBeNull();
  });

  it("turns off at once when the blocker isn't running", async () => {
    const userId = await listener();
    await prisma.spotifyConnection.update({ where: { userId }, data: { status: "disconnected", refreshTokenEnc: null } });
    await applySettings(userId, { enabled: false });
    const current = await row(userId);
    expect(current.enabled).toBe(false);
    expect(current.offAt).toBeNull();
  });

  it("delays wider allowed hours and applies narrower ones at once", async () => {
    const userId = await listener({ quietHours: { start: "06:00", end: "08:00" } });

    await applySettings(userId, { quietHours: { start: "06:00", end: "10:00" } });
    let current = await row(userId);
    expect(current.quietHours).toEqual({ start: "06:00", end: "08:00" });
    expect(current.pendingQuietHours).toEqual({ start: "06:00", end: "10:00" });
    expect(current.quietHoursAt).not.toBeNull();

    await elapse(userId);
    current = await settlePending(await row(userId));
    expect(current.quietHours).toEqual({ start: "06:00", end: "10:00" });
    expect(current.pendingQuietHours).toBeNull();

    await applySettings(userId, { quietHours: { start: "07:00", end: "08:00" } });
    current = await row(userId);
    expect(current.quietHours).toEqual({ start: "07:00", end: "08:00" });
    expect(current.quietHoursAt).toBeNull();

    await applySettings(userId, { quietHours: null });
    expect((await row(userId)).quietHours).toBeNull();
  });

  it("drops a waiting widening when the current hours are saved again", async () => {
    const userId = await listener({ quietHours: { start: "06:00", end: "08:00" } });
    await applySettings(userId, { quietHours: { start: "05:00", end: "08:00" } });
    await applySettings(userId, { quietHours: { start: "06:00", end: "08:00" } });
    const current = await row(userId);
    expect(current.pendingQuietHours).toBeNull();
    expect(current.quietHoursAt).toBeNull();
  });

  it("applies any allowed hours at once while the blocker is off", async () => {
    const userId = await listener({ enabled: false });
    await applySettings(userId, { quietHours: { start: "00:00", end: "23:00" } });
    const current = await row(userId);
    expect(current.quietHours).toEqual({ start: "00:00", end: "23:00" });
    expect(current.quietHoursAt).toBeNull();
  });
});
