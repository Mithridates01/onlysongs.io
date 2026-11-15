import { describe, expect, it } from "vitest";
import { switchBlockedReason } from "../src/lib/switch-reason";

const URI = "https://onlysongs.io/callback/spotify";

describe("switchBlockedReason", () => {
  it("names the redirect URI when Spotify sign-in never finished", () => {
    expect(switchBlockedReason("needs_connect", true, URI)).toContain(URI);
  });

  it("explains a missing app, a revoked connection and a missing song", () => {
    expect(switchBlockedReason("disconnected", false, URI)).toMatch(/add your Spotify app/);
    expect(switchBlockedReason("broken", true, URI)).toMatch(/Reconnect/);
    expect(switchBlockedReason("connected", false, URI)).toMatch(/Pick a replacement song/);
  });

  it("says nothing when the switch can be turned on", () => {
    expect(switchBlockedReason("connected", true, URI)).toBeNull();
    expect(switchBlockedReason("quota_paused", true, URI)).toBeNull();
  });
});
