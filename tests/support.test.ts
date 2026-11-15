import { describe, expect, it } from "vitest";
import { diagnose, type AccountSnapshot } from "../src/lib/support";

const NOW = new Date("2026-11-15T12:00:00Z");
const URI = "https://onlysongs.io/callback/spotify";

function account(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    emailVerified: true,
    spotify: { status: "connected", hasRefreshToken: true, signInStartedAt: null, signInExpiresAt: null },
    settings: { enabled: true, intervalSeconds: 5, hasSong: true, quietHours: null, timeZone: "UTC" },
    poll: { lastCheckedAt: new Date(NOW.getTime() - 3000), consecutiveFailures: 0, lastError: null, pausedUntil: null, pauseReason: null },
    workerOnline: true,
    ...overrides,
  };
}

const texts = (a: AccountSnapshot) => diagnose(a, URI, NOW).map((finding) => finding.text).join("\n");

describe("diagnose", () => {
  it("finds nothing wrong with a healthy, running account", () => {
    expect(texts(account())).toBe("No problems found.");
  });

  it("explains a Spotify sign-in that started but never came back", () => {
    const stuck = account({
      spotify: { status: "pending", hasRefreshToken: false, signInStartedAt: new Date(NOW.getTime() - 3600_000), signInExpiresAt: new Date(NOW.getTime() - 3000_000) },
    });
    expect(texts(stuck)).toMatch(/never came back/);
    expect(texts(stuck)).toContain(URI);
  });

  it("tells keys-saved-but-never-connected apart from sign-in in progress", () => {
    const neverPressed = account({ spotify: { status: "pending", hasRefreshToken: false, signInStartedAt: null, signInExpiresAt: null } });
    expect(texts(neverPressed)).toMatch(/never pressed Connect/);
    const inProgress = account({
      spotify: { status: "pending", hasRefreshToken: false, signInStartedAt: NOW, signInExpiresAt: new Date(NOW.getTime() + 600_000) },
    });
    expect(texts(inProgress)).toMatch(/in progress/);
  });

  it("names a missing song, a missing app and a revoked connection", () => {
    expect(texts(account({ settings: { ...account().settings, hasSong: false, enabled: false } }))).toMatch(/Pick a replacement song/);
    expect(texts(account({ spotify: null }))).toMatch(/add your Spotify app/);
    expect(texts(account({ spotify: { status: "broken", hasRefreshToken: true, signInStartedAt: null, signInExpiresAt: null } }))).toMatch(/Reconnect/);
  });

  it("flags checks that stopped running, an offline worker and repeated failures", () => {
    expect(texts(account({ poll: { ...account().poll, lastCheckedAt: new Date(NOW.getTime() - 10 * 60_000) } }))).toMatch(/no check has run recently/);
    expect(texts(account({ workerOnline: false }))).toMatch(/worker is offline/);
    expect(texts(account({ poll: { ...account().poll, consecutiveFailures: 12, lastError: "HTTP 500" } }))).toMatch(/12 checks failed in a row.*HTTP 500/);
  });

  it("notes a ready account that is simply switched off, and skips staleness during quiet hours", () => {
    expect(texts(account({ settings: { ...account().settings, enabled: false } }))).toMatch(/switched off/);
    const quiet = account({
      settings: { ...account().settings, quietHours: { start: "00:00", end: "23:59" } },
      poll: { ...account().poll, lastCheckedAt: null },
    });
    expect(texts(quiet)).toMatch(/Quiet hours are on/);
    expect(texts(quiet)).not.toMatch(/no check has run/);
  });
});
