import { describe, expect, it } from "vitest";
import { classifyTokenError } from "../src/lib/spotify-auth";
import { isQuotaExceeded, parseRetryAfter, refreshTokens } from "../src/lib/spotify";

describe("spotify http fixtures", () => {
  it("parses retry-after seconds and dates", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(parseRetryAfter("15", now)).toBe(15);
    expect(parseRetryAfter("0", now)).toBe(1);
    expect(parseRetryAfter(new Date(now + 30_000).toUTCString(), now)).toBe(30);
    expect(parseRetryAfter(null, now)).toBe(60);
  });

  it("detects a quota-exceeded 429 body", () => {
    expect(isQuotaExceeded({ error: { status: 429, message: "quota", reason: "QUOTA_EXCEEDED" } })).toBe(true);
    expect(isQuotaExceeded({ error: { status: 429, message: "slow down" } })).toBe(false);
    expect(classifyTokenError({ error: "invalid_grant", error_description: "Refresh token revoked" })).toBe("invalid_grant");
    expect(classifyTokenError({ error: "invalid_client" })).toBe("other");
  });

  it("refreshes tokens and keeps the previous refresh token when Spotify omits a new one", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ access_token: "access-2", expires_in: 3600, token_type: "Bearer" }), { status: 200 });
    const result = await refreshTokens({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh-1",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessToken).toBe("access-2");
      expect(result.refreshToken).toBeNull();
    }
  });

  it("flags invalid_grant from the token endpoint", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Refresh token revoked" }), { status: 400 });
    const result = await refreshTokens({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh-1",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invalidGrant).toBe(true);
  });
});
