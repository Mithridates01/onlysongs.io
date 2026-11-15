import { describe, expect, it } from "vitest";
import { countHealth, earlyAccessStats } from "../src/lib/admin-metrics";
import { funnel, setupStage } from "../src/lib/setup-stage";

const NOW = new Date("2026-11-15T12:00:00Z");
const connected = { status: "connected" as const, hasRefreshToken: true };

describe("setupStage", () => {
  it("names the first step someone hasn't done", () => {
    expect(setupStage({ spotify: null, hasSong: false, enabled: false, swaps: 0 })).toMatchObject({ reached: 0, label: "Hasn’t added Spotify keys" });
    expect(setupStage({ spotify: { status: "pending", hasRefreshToken: false }, hasSong: false, enabled: false, swaps: 0 })).toMatchObject({
      reached: 1,
      label: "Stuck at Spotify sign-in",
    });
    expect(setupStage({ spotify: connected, hasSong: false, enabled: false, swaps: 0 })).toMatchObject({ reached: 2, label: "Needs a song" });
    expect(setupStage({ spotify: connected, hasSong: true, enabled: false, swaps: 0 })).toMatchObject({ reached: 3, label: "Blocker off" });
    expect(setupStage({ spotify: connected, hasSong: true, enabled: true, swaps: 0 })).toMatchObject({ reached: 4, label: "On, no swaps yet" });
    expect(setupStage({ spotify: connected, hasSong: true, enabled: true, swaps: 3 })).toMatchObject({ reached: 5, label: "Working", tone: "good" });
  });

  it("counts a past swap as the whole way through, and flags lost access", () => {
    expect(setupStage({ spotify: connected, hasSong: true, enabled: false, swaps: 1 })).toMatchObject({ reached: 5, label: "Turned the blocker off" });
    expect(setupStage({ spotify: { status: "broken", hasRefreshToken: false }, hasSong: true, enabled: false, swaps: 0 })).toMatchObject({
      reached: 3,
      label: "Spotify access lost",
      tone: "bad",
    });
  });

  it("builds a funnel that only narrows", () => {
    const stages = [
      setupStage({ spotify: null, hasSong: false, enabled: false, swaps: 0 }),
      setupStage({ spotify: { status: "pending", hasRefreshToken: false }, hasSong: false, enabled: false, swaps: 0 }),
      setupStage({ spotify: connected, hasSong: true, enabled: true, swaps: 2 }),
    ];
    expect(funnel(stages).map((step) => step.count)).toEqual([3, 2, 1, 1, 1, 1]);
  });
});

describe("countHealth", () => {
  const base = { enabled: true, intervalSeconds: 5, status: "connected", lastCheckedAt: new Date(NOW.getTime() - 10_000), consecutiveFailures: 0, pausedUntil: null };

  it("counts blockers that are on but not being checked", () => {
    const health = countHealth(
      [
        base,
        { ...base, lastCheckedAt: new Date(NOW.getTime() - 5 * 60_000) },
        { ...base, lastCheckedAt: null },
        { ...base, enabled: false, lastCheckedAt: null },
        { ...base, lastCheckedAt: null, pausedUntil: new Date(NOW.getTime() + 60_000) },
      ],
      NOW,
    );
    expect(health).toMatchObject({ blockersOn: 4, behind: 2, paused: 1 });
  });

  it("counts failing and lost connections", () => {
    const health = countHealth([{ ...base, consecutiveFailures: 12 }, { ...base, enabled: false, status: "broken" }], NOW);
    expect(health).toMatchObject({ failing: 1, broken: 1, behind: 0 });
  });
});

describe("earlyAccessStats", () => {
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

  it("reports waits, approval time and invite outcomes", () => {
    const stats = earlyAccessStats(
      [
        { status: "pending", createdAt: hoursAgo(72), decidedAt: null, inviteExpiresAt: null },
        { status: "pending", createdAt: hoursAgo(2), decidedAt: null, inviteExpiresAt: null },
        { status: "joined", createdAt: hoursAgo(100), decidedAt: hoursAgo(90), inviteExpiresAt: null },
        { status: "invited", createdAt: hoursAgo(400), decidedAt: hoursAgo(380), inviteExpiresAt: hoursAgo(1) },
        { status: "invited", createdAt: hoursAgo(10), decidedAt: hoursAgo(6), inviteExpiresAt: hoursAgo(-300) },
        { status: "declined", createdAt: hoursAgo(10), decidedAt: hoursAgo(9), inviteExpiresAt: null },
      ],
      NOW,
    );
    expect(stats).toEqual({ waiting: 2, oldestWaitDays: 3, medianApproveHours: 10, invited: 3, joined: 1, expired: 1 });
  });

  it("is empty-safe", () => {
    expect(earlyAccessStats([], NOW)).toMatchObject({ waiting: 0, oldestWaitDays: null, medianApproveHours: null });
  });
});
