import { describe, expect, it } from "vitest";
import { changeKey, snapshot } from "../src/lib/listening";

const song = (uri: string, extra: Record<string, unknown> = {}) => ({
  is_playing: true,
  currently_playing_type: "track",
  progress_ms: 1200,
  shuffle_state: true,
  repeat_state: "off",
  context: { type: "playlist", uri: "spotify:playlist:abc" },
  device: { name: "Kitchen", type: "Speaker", volume_percent: 40 },
  item: { type: "track", uri, name: "Song", duration_ms: 200000, artists: [{ name: "A" }, { name: "B" }], album: { name: "LP" } },
  ...extra,
});

describe("listening snapshot", () => {
  it("keeps every field the player read already returns", () => {
    expect(snapshot(song("spotify:track:x"))).toEqual({
      kind: "track",
      itemUri: "spotify:track:x",
      title: "Song",
      artists: "A, B",
      album: "LP",
      showName: null,
      durationMs: 200000,
      progressMs: 1200,
      contextType: "playlist",
      contextUri: "spotify:playlist:abc",
      deviceName: "Kitchen",
      deviceType: "Speaker",
      volumePercent: 40,
      shuffle: true,
      repeatState: "off",
    });
  });

  it("reads episodes, ads, and paused or empty players", () => {
    const episode = snapshot({
      is_playing: true,
      currently_playing_type: "episode",
      item: { type: "episode", uri: "spotify:episode:e", name: "Ep 1", show: { name: "Show" } },
    });
    expect(episode).toMatchObject({ kind: "episode", title: "Ep 1", showName: "Show", artists: null });
    expect(snapshot({ is_playing: true, currently_playing_type: "ad", item: null }).kind).toBe("ad");
    expect(snapshot(song("spotify:track:x", { is_playing: false })).kind).toBe("none");
    expect(snapshot(null).kind).toBe("none");
  });

  it("treats the same item as no change, whatever else moved", () => {
    const a = snapshot(song("spotify:track:x"));
    const b = snapshot(song("spotify:track:x", { progress_ms: 90000, device: { name: "Phone", type: "Smartphone", volume_percent: 10 } }));
    expect(changeKey(a)).toBe(changeKey(b));
    expect(changeKey(a)).not.toBe(changeKey(snapshot(song("spotify:track:y"))));
    expect(changeKey(snapshot(null))).toBe("none");
  });
});
