import { afterEach, describe, expect, it } from "vitest";
import { decryptString } from "../../src/lib/crypto";
import { prisma } from "../../src/lib/db";
import { runUserCheck } from "../../src/lib/blocker-run";
import {
  TRACK_URI,
  deleteUser,
  emptyResponse,
  episodePlayback,
  jsonResponse,
  quietWindowCoveringNow,
  seedListener,
  spotifyRoute,
  stubFetch,
  trackPlayback,
  type RecordedCall,
} from "./helpers";

describe("runUserCheck against Postgres and Redis", () => {
  const created: string[] = [];

  afterEach(async () => {
    while (created.length) {
      const id = created.pop();
      if (id) await deleteUser(id);
    }
  });

  it("leaves a playing track alone and clears earlier failures", async () => {
    const user = await seedListener({ failures: 3 });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, { player: () => jsonResponse(200, trackPlayback()) }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("music");
      expect(spotify.calls).toHaveLength(1);
      expect(spotify.calls[0]?.method).toBe("GET");
      expect(spotify.calls[0]?.url).toContain("/me/player");
      const poll = await prisma.pollState.findUniqueOrThrow({ where: { userId: user.id } });
      expect(poll.nowPlayingTitle).toBe("Kept Song");
      expect(poll.consecutiveFailures).toBe(0);
      expect(await prisma.activityLog.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      spotify.restore();
    }
  });

  it("replaces a playing episode with the saved track", async () => {
    const user = await seedListener({ failures: 3 });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, {
        player: () => jsonResponse(200, episodePlayback()),
        play: () => emptyResponse(204),
      }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("replaced");
      const play = callTo(spotify.calls, "/me/player/play");
      expect(play.method).toBe("PUT");
      expect(play.url).toContain("device_id=device1");
      expect(JSON.parse(play.body ?? "")).toEqual({ uris: [TRACK_URI] });
      expect(play.authorization).toBe("Bearer access-old");
      const poll = await prisma.pollState.findUniqueOrThrow({ where: { userId: user.id } });
      expect(poll.nowPlayingTitle).toBe("Test Track");
      expect(poll.consecutiveFailures).toBe(0);
      expect(poll.cooldownUntil).not.toBeNull();
      const cooldownMs = (poll.cooldownUntil?.getTime() ?? 0) - Date.now();
      expect(cooldownMs).toBeGreaterThan(5_000);
      expect(cooldownMs).toBeLessThan(20_000);
      const activity = await prisma.activityLog.findFirstOrThrow({ where: { userId: user.id } });
      expect(activity.action).toBe("swap");
      expect(activity.result).toBe("replaced");
      expect(activity.showName).toBe("Daily News");
    } finally {
      spotify.restore();
    }
  });

  it("leaves an allow-listed show playing and logs the skip", async () => {
    const user = await seedListener({
      failures: 3,
      allowedShows: [{ id: "Show123", name: "Daily News" }],
    });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, { player: () => jsonResponse(200, episodePlayback()) }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("allow_listed");
      expect(spotify.calls).toHaveLength(1);
      const poll = await prisma.pollState.findUniqueOrThrow({ where: { userId: user.id } });
      expect(poll.consecutiveFailures).toBe(0);
      const activity = await prisma.activityLog.findFirstOrThrow({ where: { userId: user.id } });
      expect(activity.action).toBe("skip");
      expect(activity.result).toBe("allow_listed");
      expect(activity.showName).toBe("Daily News");
    } finally {
      spotify.restore();
    }
  });

  it("skips the Spotify call during quiet hours", async () => {
    const user = await seedListener({ failures: 3, quietHours: quietWindowCoveringNow() });
    created.push(user.id);
    const spotify = stubFetch(() => {
      throw new Error("quiet hours called Spotify");
    });
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("quiet_hours");
      expect(spotify.calls).toHaveLength(0);
      const poll = await prisma.pollState.findUniqueOrThrow({ where: { userId: user.id } });
      expect(poll.lastCheckedAt).not.toBeNull();
      expect(poll.consecutiveFailures).toBe(3);
    } finally {
      spotify.restore();
    }
  });

  it("refreshes once after a 401 and then finishes the check", async () => {
    const user = await seedListener();
    created.push(user.id);
    let playerCalls = 0;
    const spotify = stubFetch((call) =>
      spotifyRoute(call, {
        player: () => {
          playerCalls += 1;
          if (playerCalls === 1) return jsonResponse(401, { error: { status: 401, message: "expired" } });
          return jsonResponse(200, trackPlayback());
        },
        token: () => jsonResponse(200, { access_token: "access-new", token_type: "Bearer", expires_in: 3600 }),
      }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("music");
      expect(playerCalls).toBe(2);
      const tokenCalls = spotify.calls.filter((call) => call.url.includes("/api/token"));
      expect(tokenCalls).toHaveLength(1);
      expect(tokenCalls[0]?.authorization?.startsWith("Basic ")).toBe(true);
      const playerAuths = spotify.calls.filter((call) => call.url.includes("/me/player")).map((call) => call.authorization);
      expect(playerAuths).toEqual(["Bearer access-old", "Bearer access-new"]);
      const connection = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
      expect(decryptString(connection.accessTokenEnc ?? "")).toBe("access-new");
      expect(decryptString(connection.refreshTokenEnc ?? "")).toBe("refresh-old");
      expect(connection.status).toBe("connected");
    } finally {
      spotify.restore();
    }
  });

  it("marks the connection broken when the refreshed token is still rejected", async () => {
    const user = await seedListener();
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, {
        player: () => jsonResponse(401, { error: { status: 401, message: "expired" } }),
        token: () => jsonResponse(200, { access_token: "access-new", token_type: "Bearer", expires_in: 3600 }),
      }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("broken");
      const connection = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
      expect(connection.status).toBe("broken");
      expect(connection.accessTokenEnc).toBeNull();
      const settings = await prisma.blockerSettings.findUniqueOrThrow({ where: { userId: user.id } });
      expect(settings.enabled).toBe(false);
      const activity = await prisma.activityLog.findFirstOrThrow({ where: { userId: user.id } });
      expect(activity.result).toBe("broken");
    } finally {
      spotify.restore();
    }
  });

  it("turns the blocker off when Spotify revokes the refresh token", async () => {
    const user = await seedListener({ expiresAt: new Date(Date.now() - 60_000) });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, {
        token: () => jsonResponse(400, { error: "invalid_grant", error_description: "Refresh token revoked" }),
      }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("broken");
      expect(spotify.calls.map((call) => call.url).every((url) => url.includes("/api/token"))).toBe(true);
      const settings = await prisma.blockerSettings.findUniqueOrThrow({ where: { userId: user.id } });
      expect(settings.enabled).toBe(false);
    } finally {
      spotify.restore();
    }
  });

  it.each([403, 404])("falls back to skip-next when play returns %s", async (status) => {
    const user = await seedListener({ failures: 3 });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, {
        player: () => jsonResponse(200, episodePlayback()),
        play: () => jsonResponse(status, { error: { status, message: "nope" } }),
        next: () => emptyResponse(204),
      }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("replaced_via_next");
      const next = callTo(spotify.calls, "/me/player/next");
      expect(next.method).toBe("POST");
      expect(next.url).toContain("device_id=device1");
      const poll = await prisma.pollState.findUniqueOrThrow({ where: { userId: user.id } });
      expect(poll.nowPlayingTitle).toBe("Skipped ahead");
      expect(poll.consecutiveFailures).toBe(0);
      const activity = await prisma.activityLog.findFirstOrThrow({ where: { userId: user.id } });
      expect(activity.action).toBe("fallback_next");
      expect(activity.result).toBe("replaced_via_next");
    } finally {
      spotify.restore();
    }
  });

  it("does not count a restricted device as a failed check", async () => {
    const user = await seedListener({ failures: 3 });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, {
        player: () => jsonResponse(200, episodePlayback()),
        play: () => jsonResponse(403, { error: { status: 403, message: "restricted" } }),
        next: () => jsonResponse(403, { error: { status: 403, message: "restricted" } }),
      }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("restricted");
      const poll = await prisma.pollState.findUniqueOrThrow({ where: { userId: user.id } });
      expect(poll.consecutiveFailures).toBe(3);
    } finally {
      spotify.restore();
    }
  });

  it("counts a failed play after a successful player read", async () => {
    const user = await seedListener({ failures: 3 });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, {
        player: () => jsonResponse(200, episodePlayback()),
        play: () => jsonResponse(500, { error: { status: 500, message: "upstream" } }),
      }),
    );
    try {
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("failed");
      const poll = await prisma.pollState.findUniqueOrThrow({ where: { userId: user.id } });
      expect(poll.consecutiveFailures).toBe(4);
      expect(poll.lastError).toContain("500");
    } finally {
      spotify.restore();
    }
  });

  it("pauses that user for an hour when Spotify returns QUOTA_EXCEEDED", async () => {
    const user = await seedListener({ failures: 2 });
    created.push(user.id);
    const spotify = stubFetch((call) =>
      spotifyRoute(call, {
        player: () => jsonResponse(429, { error: { status: 429, message: "quota", reason: "QUOTA_EXCEEDED" } }),
      }),
    );
    try {
      const before = Date.now();
      const summary = await runUserCheck(user.id);
      expect(summary.outcome).toBe("quota");
      const poll = await prisma.pollState.findUniqueOrThrow({ where: { userId: user.id } });
      const pauseMs = (poll.pausedUntil?.getTime() ?? 0) - before;
      expect(pauseMs).toBeGreaterThan(59 * 60 * 1000);
      expect(pauseMs).toBeLessThan(61 * 60 * 1000);
      expect(poll.consecutiveFailures).toBe(2);
      expect(poll.quotaNotifiedAt).not.toBeNull();
      const connection = await prisma.spotifyConnection.findUniqueOrThrow({ where: { userId: user.id } });
      expect(connection.status).toBe("quota_paused");
      const activity = await prisma.activityLog.findFirstOrThrow({ where: { userId: user.id } });
      expect(activity.result).toBe("quota");
      expect(activity.httpStatus).toBe(429);
    } finally {
      spotify.restore();
    }
  });

  it("returns busy when a second check overlaps the Redis lock", async () => {
    const user = await seedListener();
    created.push(user.id);
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let opened = () => {};
    const started = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const spotify = stubFetch(async (call) => {
      opened();
      await hold;
      return spotifyRoute(call, { player: () => jsonResponse(200, trackPlayback()) });
    });
    try {
      const first = runUserCheck(user.id);
      await started;
      const second = await runUserCheck(user.id);
      expect(second.outcome).toBe("busy");
      release();
      await expect(first).resolves.toMatchObject({ outcome: "music" });
    } finally {
      release();
      spotify.restore();
    }
  });
});

function callTo(calls: RecordedCall[], fragment: string): RecordedCall {
  const call = calls.find((item) => item.url.includes(fragment));
  if (!call) throw new Error(`Missing Spotify request containing ${fragment}`);
  return call;
}
