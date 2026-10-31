import { describe, expect, it } from "vitest";
import {
  COOLDOWN_MS,
  QUOTA_PAUSE_MS,
  classifyHttpStatus,
  classifyPlayback,
  isAllowListed,
  playBodyFor,
  playOutcome,
  retryPauseMs,
  type PlaybackResult,
  type PlayerBody,
} from "../src/lib/blocker-logic";
import { callWithAuthRetry, ensureAccessToken, tokenNeedsRefresh } from "../src/lib/spotify-auth";

function playing(body: PlayerBody): PlaybackResult {
  return { ok: true, status: 200, body };
}

const bothOn = { blockPodcasts: true, blockAudiobooks: true };
const booksOff = { blockPodcasts: true, blockAudiobooks: false };
const podcastsOff = { blockPodcasts: false, blockAudiobooks: true };

const episodeItem = {
  type: "episode",
  uri: "spotify:episode:ep1",
  name: "The warehouse",
  show: { id: "show1", name: "Night Desk", uri: "spotify:show:show1" },
};

describe("classifyPlayback", () => {
  it("leaves a music track alone", () => {
    const result = classifyPlayback(
      playing({
        is_playing: true,
        currently_playing_type: "track",
        item: { type: "track", uri: "spotify:track:abc", name: "Under the Pressure" },
      }),
      bothOn,
    );
    expect(result.kind).toBe("music");
  });

  it("blocks a podcast episode", () => {
    const result = classifyPlayback(
      playing({
        is_playing: true,
        currently_playing_type: "episode",
        device: { id: "phone", name: "iPhone" },
        item: episodeItem,
      }),
      bothOn,
    );
    expect(result.kind).toBe("block");
    if (result.kind === "block") {
      expect(result.target.showId).toBe("show1");
      expect(result.target.showName).toBe("Night Desk");
      expect(result.target.episodeName).toBe("The warehouse");
      expect(result.target.deviceId).toBe("phone");
      expect(result.target.kind).toBe("episode");
    }
  });

  it("blocks an episode even when the playing type is missing", () => {
    const result = classifyPlayback(playing({ is_playing: true, item: episodeItem }), booksOff);
    expect(result.kind).toBe("block");
  });

  it("leaves a podcast alone when podcast blocking is off", () => {
    const result = classifyPlayback(
      playing({ is_playing: true, currently_playing_type: "episode", item: episodeItem }),
      { blockPodcasts: false, blockAudiobooks: false },
    );
    expect(result).toEqual({ kind: "ignored", content: "episode" });
  });

  it("blocks a chapter when audiobooks are on", () => {
    const result = classifyPlayback(
      playing({
        is_playing: true,
        item: { type: "chapter", uri: "spotify:chapter:ch1", name: "Chapter 2", audiobook: { id: "book1", name: "The book" } },
      }),
      bothOn,
    );
    expect(result.kind).toBe("block");
    if (result.kind === "block") {
      expect(result.target.kind).toBe("audiobook");
      expect(result.target.showName).toBe("The book");
    }
  });

  it("ignores a chapter when audiobooks are off", () => {
    const result = classifyPlayback(
      playing({ is_playing: true, item: { type: "chapter", uri: "spotify:chapter:ch1", name: "Chapter 2" } }),
      booksOff,
    );
    expect(result).toEqual({ kind: "ignored", content: "audiobook" });
  });

  it("treats an episode that belongs to an audiobook as an audiobook", () => {
    const chapter = playing({
      is_playing: true,
      currently_playing_type: "episode",
      context: { type: "audiobook", uri: "spotify:audiobook:book1" },
      item: {
        type: "episode",
        uri: "spotify:episode:ch1",
        name: "Chapter 2",
        audiobook: { id: "book1", name: "The book", uri: "spotify:audiobook:book1" },
      },
    });
    const blocked = classifyPlayback(chapter, podcastsOff);
    expect(blocked.kind).toBe("block");
    if (blocked.kind === "block") {
      expect(blocked.target.kind).toBe("audiobook");
      expect(blocked.target.showId).toBe("book1");
      expect(blocked.target.showName).toBe("The book");
    }
    expect(classifyPlayback(chapter, booksOff)).toEqual({ kind: "ignored", content: "audiobook" });
  });

  it("blocks an audiobook uri", () => {
    const result = classifyPlayback(
      playing({ is_playing: true, item: { uri: "spotify:audiobook:book9", name: "A novel" } }),
      bothOn,
    );
    expect(result.kind).toBe("block");
  });

  it("blocks when the item is null but the playing type is episode", () => {
    const result = classifyPlayback(
      playing({ is_playing: true, currently_playing_type: "episode", item: null, device: { name: "Car" } }),
      bothOn,
    );
    expect(result.kind).toBe("block");
    if (result.kind === "block") expect(result.target.episodeName).toBeUndefined();
  });

  it("does nothing for a null item that is not an episode", () => {
    const result = classifyPlayback(playing({ is_playing: true, currently_playing_type: "track", item: null }), bothOn);
    expect(result.kind).toBe("music");
  });

  it("treats 204 as idle", () => {
    expect(classifyPlayback({ ok: true, status: 204 }, bothOn).kind).toBe("idle");
    expect(classifyHttpStatus(204)).toBe("empty");
  });

  it("leaves a paused podcast alone", () => {
    const result = classifyPlayback(playing({ is_playing: false, currently_playing_type: "episode", item: episodeItem }), bothOn);
    expect(result.kind).toBe("idle");
  });

  it("respects an allow-listed show id", () => {
    expect(isAllowListed("show1", ["show1", "show2"])).toBe(true);
    expect(isAllowListed("other", ["show1"])).toBe(false);
    expect(isAllowListed(undefined, ["show1"])).toBe(false);
  });
});

describe("play commands", () => {
  it("sends a track uri or a context uri", () => {
    expect(playBodyFor({ uri: "spotify:track:abc", kind: "track" })).toEqual({ uris: ["spotify:track:abc"] });
    expect(playBodyFor({ uri: "spotify:track:abc", kind: "track" }, "spotify:album:xyz")).toEqual({
      context_uri: "spotify:album:xyz",
      offset: { uri: "spotify:track:abc" },
    });
    expect(playBodyFor({ uri: "spotify:album:abc", kind: "album" }, "spotify:album:xyz")).toEqual({ context_uri: "spotify:album:abc" });
    expect(playBodyFor({ uri: "spotify:playlist:abc", kind: "playlist" })).toEqual({ context_uri: "spotify:playlist:abc" });
    expect(playBodyFor({ uri: "spotify:album:abc", kind: "album" })).toEqual({ context_uri: "spotify:album:abc" });
  });

  it("maps 204, 403, and 404 responses", () => {
    expect(playOutcome(204)).toBe("ok");
    expect(playOutcome(202)).toBe("ok");
    expect(playOutcome(403)).toBe("fallback_next");
    expect(playOutcome(404)).toBe("fallback_next");
    expect(playOutcome(500)).toBe("error");
    expect(playOutcome(0)).toBe("error");
    expect(classifyHttpStatus(403)).toBe("restricted_or_missing");
    expect(classifyHttpStatus(404)).toBe("restricted_or_missing");
    expect(classifyHttpStatus(429)).toBe("rate_limited");
    expect(classifyHttpStatus(500)).toBe("server");
    expect(classifyHttpStatus(401)).toBe("unauthorized");
  });

  it("honours retry-after and pauses an hour on quota", () => {
    expect(retryPauseMs(12, false)).toBe(12_000);
    expect(retryPauseMs(undefined, false)).toBe(60_000);
    expect(retryPauseMs(1, true)).toBe(QUOTA_PAUSE_MS);
    expect(COOLDOWN_MS).toBe(15_000);
  });
});

describe("token refresh", () => {
  const now = new Date("2026-10-14T12:00:00Z");

  it("refreshes a token that expires within 60 seconds", () => {
    expect(tokenNeedsRefresh(new Date(now.getTime() + 30_000), now)).toBe(true);
    expect(tokenNeedsRefresh(null, now)).toBe(true);
    expect(tokenNeedsRefresh(new Date(now.getTime() + 120_000), now)).toBe(false);
  });

  it("keeps a fresh access token", async () => {
    let calls = 0;
    const ensured = await ensureAccessToken(
      { accessToken: "live", refreshToken: "refresh", expiresAt: new Date(now.getTime() + 120_000) },
      now,
      async () => {
        calls += 1;
        return { ok: true, accessToken: "new", refreshToken: "refresh", expiresIn: 3600 };
      },
    );
    expect(calls).toBe(0);
    expect(ensured.ok && ensured.accessToken).toBe("live");
  });

  it("refreshes before use when the token is near expiry", async () => {
    const ensured = await ensureAccessToken(
      { accessToken: "stale", refreshToken: "refresh", expiresAt: new Date(now.getTime() + 10_000) },
      now,
      async () => ({ ok: true, accessToken: "fresh", refreshToken: "rotated", expiresIn: 3600 }),
    );
    expect(ensured.ok && ensured.refreshed).toBe(true);
    if (ensured.ok) {
      expect(ensured.accessToken).toBe("fresh");
      expect(ensured.refreshToken).toBe("rotated");
      expect(ensured.expiresAt?.toISOString()).toBe("2026-10-14T13:00:00.000Z");
    }
  });

  it("marks the connection broken when Spotify revokes the refresh token", async () => {
    const ensured = await ensureAccessToken(
      { accessToken: "", refreshToken: "refresh", expiresAt: null },
      now,
      async () => ({ ok: false, error: "revoked", invalidGrant: true }),
    );
    expect(ensured.ok).toBe(false);
    if (!ensured.ok) expect(ensured.broken).toBe(true);
  });

  it("retries a 401 once and then gives up if the new token is also rejected", async () => {
    const calls: string[] = [];
    const outcome = await callWithAuthRetry({
      state: { accessToken: "old", refreshToken: "refresh", expiresAt: new Date(now.getTime() + 120_000) },
      now,
      refresh: async () => ({ ok: true, accessToken: "fresh", refreshToken: "refresh", expiresIn: 3600 }),
      call: async (token) => {
        calls.push(token);
        return { status: 401 };
      },
    });
    expect(calls).toEqual(["old", "fresh"]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.broken).toBe(true);
  });

  it("retries a 401 and returns the second response", async () => {
    const outcome = await callWithAuthRetry({
      state: { accessToken: "old", refreshToken: "refresh", expiresAt: new Date(now.getTime() + 120_000) },
      now,
      refresh: async () => ({ ok: true, accessToken: "fresh", refreshToken: "refresh", expiresIn: 3600 }),
      call: async (token) => ({ status: token === "fresh" ? 204 : 401 }),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.status).toBe(204);
  });

  it("does not mark a transient refresh failure as broken", async () => {
    const outcome = await callWithAuthRetry({
      state: { accessToken: "old", refreshToken: "refresh", expiresAt: new Date(now.getTime() + 5_000) },
      now,
      refresh: async () => ({ ok: false, error: "spotify down", invalidGrant: false }),
      call: async () => ({ status: 200 }),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.broken).toBe(false);
  });
});
