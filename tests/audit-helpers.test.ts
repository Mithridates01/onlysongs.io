import { describe, expect, it } from "vitest";
import { isOperator } from "../src/lib/admin";
import { buildCsp, newNonce } from "../src/lib/csp";
import { csvCell, toCsv } from "../src/lib/csv";
import { safeNextPath } from "../src/lib/safe-path";
import { settingsPatch, spotifyCredentials, spotifyImageUrl } from "../src/lib/schemas";

describe("isOperator", () => {
  it("needs both the admin flag and a verified email", () => {
    expect(isOperator({ isAdmin: true, emailVerifiedAt: new Date() })).toBe(true);
    expect(isOperator({ isAdmin: true, emailVerifiedAt: null })).toBe(false);
    expect(isOperator({ isAdmin: false, emailVerifiedAt: new Date() })).toBe(false);
    expect(isOperator(null)).toBe(false);
  });
});

describe("csv export", () => {
  it("defuses cells that a spreadsheet would run as formulas", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1 for podcasts")).toBe("'+1 for podcasts");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@sum")).toBe("'@sum");
  });

  it("quotes commas, quotes and newlines and leaves plain text alone", () => {
    expect(csvCell("Hello, world")).toBe('"Hello, world"');
    expect(csvCell("Line\nbreak")).toBe('"Line\nbreak"');
    expect(csvCell("Plain")).toBe("Plain");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [["1", null]])).toBe("a,b\n1,");
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath("/activity?before=x")).toBe("/activity?before=x");
  });

  it("refuses anything that could leave the site", () => {
    for (const value of ["//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "", "/\tx", undefined, ["/a"]]) {
      expect(safeNextPath(value as string | string[] | undefined)).toBeNull();
    }
  });
});

describe("spotify credentials", () => {
  const id = "0123456789abcdef0123456789abcdef";
  it("accepts 32 hexadecimal characters, trimmed", () => {
    expect(spotifyCredentials.safeParse({ clientId: ` ${id} `, clientSecret: id.toUpperCase() }).success).toBe(true);
  });

  it("explains a mis-pasted Client ID or Secret", () => {
    const badId = spotifyCredentials.safeParse({ clientId: "client-id", clientSecret: id });
    expect(badId.success ? "" : badId.error.issues[0]?.message).toMatch(/Client ID doesn’t look right/);
    const badSecret = spotifyCredentials.safeParse({ clientId: id, clientSecret: id.slice(1) });
    expect(badSecret.success ? "" : badSecret.error.issues[0]?.message).toMatch(/Client Secret doesn’t look right/);
  });
});

describe("replacement cover art", () => {
  it("keeps https art from Spotify's image hosts only", () => {
    expect(spotifyImageUrl("https://i.scdn.co/image/ab67")).toBe("https://i.scdn.co/image/ab67");
    expect(spotifyImageUrl("https://image-cdn-ak.spotifycdn.com/image/ab67")).toBe("https://image-cdn-ak.spotifycdn.com/image/ab67");
    expect(spotifyImageUrl("http://i.scdn.co/image/ab67")).toBeNull();
    expect(spotifyImageUrl("https://evil.example/pixel.png")).toBeNull();
    expect(spotifyImageUrl("https://scdn.co.evil.example/x")).toBeNull();
    expect(spotifyImageUrl("not a url")).toBeNull();
  });

  it("drops other art instead of rejecting the replacement", () => {
    const parsed = settingsPatch.parse({
      replacement: { uri: "spotify:track:11dFghVXANMlKmJXsNCbNl", label: "Song", art: "https://evil.example/x.png", kind: "track" },
    });
    expect(parsed.replacement?.art).toBeNull();
  });
});

describe("content security policy", () => {
  it("allows scripts only by nonce, never inline", () => {
    const nonce = newNonce();
    const csp = buildCsp(nonce, false);
    const scripts = csp.split("; ").find((part) => part.startsWith("script-src")) ?? "";
    expect(scripts).toContain(`'nonce-${nonce}'`);
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("makes a fresh nonce each time", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
