import { describe, expect, it } from "vitest";
import { isQuietNow, normalizeClock, startOfZonedDay } from "../src/lib/quiet-hours";

describe("quiet hours", () => {
  it("matches a same-day window and leaves the end exclusive", () => {
    expect(isQuietNow({ start: "06:00", end: "08:00" }, "UTC", new Date("2026-10-14T07:00:00Z"))).toBe(true);
    expect(isQuietNow({ start: "06:00", end: "08:00" }, "UTC", new Date("2026-10-14T08:00:00Z"))).toBe(false);
    expect(isQuietNow({ start: "06:00", end: "08:00" }, "UTC", new Date("2026-10-14T05:59:00Z"))).toBe(false);
  });

  it("wraps overnight windows", () => {
    expect(isQuietNow({ start: "22:00", end: "06:00" }, "UTC", new Date("2026-10-14T23:10:00Z"))).toBe(true);
    expect(isQuietNow({ start: "22:00", end: "06:00" }, "UTC", new Date("2026-10-14T05:00:00Z"))).toBe(true);
    expect(isQuietNow({ start: "22:00", end: "06:00" }, "UTC", new Date("2026-10-14T12:00:00Z"))).toBe(false);
  });

  it("treats equal bounds and missing hours as off", () => {
    expect(isQuietNow({ start: "06:00", end: "06:00" }, "UTC", new Date("2026-10-14T06:30:00Z"))).toBe(false);
    expect(isQuietNow(null, "UTC", new Date())).toBe(false);
  });

  it("starts today at midnight in the requested zone", () => {
    expect(startOfZonedDay("UTC", new Date("2026-10-14T15:00:00Z")).toISOString()).toBe("2026-10-14T00:00:00.000Z");
  });

  it("normalizes browser time values", () => {
    expect(normalizeClock("06:00:00")).toBe("06:00");
    expect(normalizeClock("6:00")).toBeNull();
  });
});
