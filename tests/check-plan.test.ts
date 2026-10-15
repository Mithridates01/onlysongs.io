import { describe, expect, it } from "vitest";
import type { PlaybackResult, PlayerBody } from "../src/lib/blocker-logic";
import { decide, preflight, settleSwap, type CheckState, type SwapPlan } from "../src/lib/check-plan";

const NOW = new Date("2026-10-14T12:00:00Z");

function state(overrides?: { settings?: Partial<CheckState["settings"]>; poll?: Partial<CheckState["poll"]>; connection?: CheckState["connection"] }): CheckState {
  return {
    settings: {
      enabled: true,
      quietHours: null,
      timeZone: "UTC",
      replacementUri: "spotify:track:abc",
      replacementKind: "track",
      replacementLabel: "My Song",
      replacementArt: "https://img/song.jpg",
      blockPodcasts: true,
      blockAudiobooks: true,
      allowedShowIds: [],
      ...overrides?.settings,
    },
    poll: { pausedUntil: null, cooldownUntil: null, quotaNotifiedAt: null, ...overrides?.poll },
    connection: overrides?.connection === undefined ? { status: "connected", hasRefreshToken: true } : overrides.connection,
  };
}

function player(body: PlayerBody): { kind: "player"; playback: PlaybackResult } {
  return { kind: "player", playback: { ok: true, status: 200, body } };
}

const EPISODE: PlayerBody = {
  is_playing: true,
  currently_playing_type: "episode",
  device: { id: "d1", name: "Phone" },
  item: { type: "episode", name: "Ep 1", uri: "spotify:episode:e1", show: { id: "Show1", name: "News" } },
};

const TRACK: PlayerBody = {
  is_playing: true,
  currently_playing_type: "track",
  item: { type: "track", name: "Song", uri: "spotify:track:t1", artists: [{ name: "A" }] },
};

describe("preflight", () => {
  it("stops in order: disabled, paused, cooldown, quiet hours, connection, replacement", () => {
    expect(preflight(state({ settings: { enabled: false } }), NOW)).toMatchObject({ result: { summary: { outcome: "disabled" } } });
    const later = new Date(NOW.getTime() + 60_000);
    expect(preflight(state({ poll: { pausedUntil: later } }), NOW)).toMatchObject({ result: { summary: { outcome: "paused" } } });
    expect(preflight(state({ poll: { cooldownUntil: later } }), NOW)).toMatchObject({ result: { summary: { outcome: "cooldown" } } });
    expect(preflight(state({ poll: { cooldownUntil: later } }), NOW, { ignoreCooldown: true }).kind).toBe("go");
    const quiet = preflight(state({ settings: { quietHours: { start: "11:00", end: "13:00" } } }), NOW);
    expect(quiet).toMatchObject({ result: { summary: { outcome: "quiet_hours" }, poll: { lastCheckedAt: NOW, lastError: null } } });
    expect(preflight(state({ connection: null }), NOW)).toMatchObject({ result: { summary: { outcome: "not_connected" } } });
    expect(preflight(state({ connection: { status: "broken", hasRefreshToken: true } }), NOW)).toMatchObject({
      result: { summary: { outcome: "broken" } },
    });
    expect(preflight(state({ settings: { replacementKind: null } }), NOW)).toMatchObject({
      result: { summary: { outcome: "no_replacement" } },
    });
  });

  it("goes with the saved replacement", () => {
    expect(preflight(state(), NOW)).toEqual({ kind: "go", replacement: { uri: "spotify:track:abc", kind: "track" } });
  });
});

describe("decide", () => {
  it("leaves music alone and clears failures and any pause", () => {
    const result = decide(player(TRACK), state(), NOW);
    expect(result).toMatchObject({
      summary: { outcome: "music" },
      poll: { failures: "reset", lastError: null, pausedUntil: null, pauseReason: null, nowPlayingKind: "track" },
    });
    expect("activity" in result && result.activity).toBeFalsy();
  });

  it("plans a swap for a blocked episode", () => {
    const plan = decide(player(EPISODE), state(), NOW);
    expect(plan).toMatchObject({ kind: "swap", target: { showId: "Show1", deviceId: "d1" } });
  });

  it("logs an allow-listed show without swapping", () => {
    const result = decide(player(EPISODE), state({ settings: { allowedShowIds: ["Show1"] } }), NOW);
    expect(result).toMatchObject({
      summary: { outcome: "allow_listed" },
      activity: { action: "skip", result: "allow_listed", showName: "News" },
    });
  });

  it("pauses for an hour on QUOTA_EXCEEDED and emails at most hourly", () => {
    const quota: PlaybackResult = { ok: false, status: 429, reason: "QUOTA_EXCEEDED" };
    const first = decide({ kind: "player", playback: quota }, state(), NOW);
    expect(first).toMatchObject({
      summary: { outcome: "quota" },
      poll: { pauseReason: "quota", pausedUntil: new Date(NOW.getTime() + 60 * 60 * 1000), quotaNotifiedAt: NOW },
      activity: { action: "error", result: "quota", httpStatus: 429 },
      notifyQuota: true,
    });
    const recent = state({ poll: { quotaNotifiedAt: new Date(NOW.getTime() - 10 * 60 * 1000) } });
    expect(decide({ kind: "player", playback: quota }, recent, NOW)).toMatchObject({ notifyQuota: false });
  });

  it("counts a player error as a failure and marks a revoked token broken", () => {
    expect(decide({ kind: "error", error: "timeout" }, state(), NOW)).toMatchObject({
      summary: { outcome: "error" },
      poll: { failures: "increment", lastError: "timeout" },
    });
    expect(decide({ kind: "broken", error: "invalid_grant" }, state(), NOW)).toMatchObject({
      summary: { outcome: "broken" },
      markBroken: true,
    });
  });
});

describe("settleSwap", () => {
  const plan = decide(player(EPISODE), state(), NOW) as SwapPlan;

  it("records a replacement with a cooldown and the new now-playing", () => {
    const result = settleSwap(plan, { kind: "done", action: "swap", result: "replaced", httpStatus: 204, replaced: true, failed: false }, state(), NOW);
    expect(result).toMatchObject({
      summary: { outcome: "replaced", detail: "Ep 1" },
      poll: { failures: "reset", cooldownUntil: new Date(NOW.getTime() + 15_000), nowPlayingTitle: "My Song", nowPlayingKind: "track" },
      activity: { action: "swap", result: "replaced", httpStatus: 204, showName: "News" },
    });
  });

  it("counts a failed play but not a device that refused skip-next", () => {
    const failed = settleSwap(plan, { kind: "done", action: "swap", result: "failed", httpStatus: 500, replaced: false, failed: true, detail: "Play returned 500" }, state(), NOW);
    expect(failed.poll).toMatchObject({ failures: "increment", lastError: "Play returned 500" });
    const refused = settleSwap(plan, { kind: "done", action: "fallback_next", result: "restricted", httpStatus: 403, replaced: false, failed: false }, state(), NOW);
    expect(refused.poll?.failures).toBeUndefined();
    expect(refused.poll?.cooldownUntil).toBeUndefined();
  });

  it("pauses on a rate limit during the swap", () => {
    const result = settleSwap(plan, { kind: "rate_limited", retryAfterSec: 30, quotaExceeded: false }, state(), NOW);
    expect(result).toMatchObject({
      summary: { outcome: "rate_limited" },
      poll: { pauseReason: "rate_limited", pausedUntil: new Date(NOW.getTime() + 30_000) },
    });
  });
});
