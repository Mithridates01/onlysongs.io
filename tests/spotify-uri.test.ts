import { describe, expect, it } from "vitest";
import { parseSpotifyUri } from "../src/lib/spotify-uri";

describe("parseSpotifyUri", () => {
  it("parses uris and open.spotify links", () => {
    expect(parseSpotifyUri("spotify:track:abcDEF123")).toEqual({
      kind: "track",
      id: "abcDEF123",
      uri: "spotify:track:abcDEF123",
    });
    expect(parseSpotifyUri("https://open.spotify.com/playlist/pl1?si=xyz")).toEqual({
      kind: "playlist",
      id: "pl1",
      uri: "spotify:playlist:pl1",
    });
    expect(parseSpotifyUri("https://open.spotify.com/album/al1")).toMatchObject({ kind: "album", id: "al1" });
    expect(parseSpotifyUri("https://open.spotify.com/embed/show/sh1")).toMatchObject({ kind: "show", id: "sh1" });
    expect(parseSpotifyUri("https://open.spotify.com/episode/ep1")).toMatchObject({ kind: "episode", id: "ep1" });
  });

  it("rejects other hosts and junk", () => {
    expect(parseSpotifyUri("https://example.com/track/abc")).toBeNull();
    expect(parseSpotifyUri("not a link")).toBeNull();
    expect(parseSpotifyUri("")).toBeNull();
  });
});
