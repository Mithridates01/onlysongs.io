import { describe, expect, it } from "vitest";
import { settingsPatch, signupBody } from "../src/lib/schemas";

function error(input: unknown): string | undefined {
  const parsed = settingsPatch.safeParse(input);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

describe("settingsPatch", () => {
  it("accepts a partial patch and normalizes quiet hours and the replacement link", () => {
    const parsed = settingsPatch.parse({
      quietHours: { start: "06:00:00", end: "07:30" },
      replacement: { uri: "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl", label: " Song ", kind: "track" },
      allowedShows: [
        { id: "Show1", name: " News " },
        { id: "Show1", name: "Duplicate" },
      ],
    });
    expect(parsed.quietHours).toEqual({ start: "06:00", end: "07:30" });
    expect(parsed.replacement).toEqual({ uri: "spotify:track:11dFghVXANMlKmJXsNCbNl", label: "Song", art: null, kind: "track" });
    expect(parsed.allowedShows).toEqual([{ id: "Show1", name: "News" }]);
  });

  it("rejects bad values with the message users see", () => {
    expect(error({ intervalSeconds: 5 })).toBe("Poll interval must be between 10 and 300 seconds.");
    expect(error({ intervalSeconds: 12.5 })).toBe("Poll interval must be between 10 and 300 seconds.");
    expect(error({ timeZone: "Mars/Olympus" })).toBe("That time zone is not recognized.");
    expect(error({ quietHours: { start: "25:00", end: "07:00" } })).toBe("Quiet hours use 24-hour times like 06:00.");
    expect(error({ quietHours: { start: "06:00", end: "06:00:00" } })).toBe("Quiet hours need a start and end that differ.");
    expect(error({ replacement: { uri: "spotify:album:abc123", label: "X", kind: "track" } })).toBe(
      "The replacement type does not match its Spotify link.",
    );
    expect(error({ enabled: "yes" })).toBe("enabled must be true or false.");
    expect(error({ surprise: true })).toBeTruthy();
  });

  it("allows clearing quiet hours and the replacement with null", () => {
    expect(settingsPatch.parse({ quietHours: null, replacement: null })).toEqual({ quietHours: null, replacement: null });
  });
});

describe("signupBody", () => {
  it("lowercases the email and requires 8 characters of password", () => {
    expect(signupBody.parse({ email: " Me@Example.COM ", password: "12345678" }).email).toBe("me@example.com");
    expect(signupBody.safeParse({ email: "me@example.com", password: "short" }).success).toBe(false);
    expect(signupBody.safeParse({ email: "not-an-email", password: "12345678" }).success).toBe(false);
  });
});
