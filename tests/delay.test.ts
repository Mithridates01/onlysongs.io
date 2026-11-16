import { describe, expect, it } from "vitest";
import { isDue, widens } from "../src/lib/delay";

describe("unlock delay rules", () => {
  it("counts any extra allowed minute as widening", () => {
    expect(widens(null, { start: "06:00", end: "07:00" })).toBe(true);
    expect(widens({ start: "06:00", end: "08:00" }, { start: "06:00", end: "08:01" })).toBe(true);
    expect(widens({ start: "06:00", end: "08:00" }, { start: "05:59", end: "07:00" })).toBe(true);
    expect(widens({ start: "22:00", end: "02:00" }, { start: "21:00", end: "01:00" })).toBe(true);
  });

  it("treats the same, a narrower window, or none as not widening", () => {
    expect(widens({ start: "06:00", end: "08:00" }, { start: "06:00", end: "08:00" })).toBe(false);
    expect(widens({ start: "06:00", end: "08:00" }, { start: "06:30", end: "07:00" })).toBe(false);
    expect(widens({ start: "22:00", end: "02:00" }, { start: "23:00", end: "01:00" })).toBe(false);
    expect(widens({ start: "22:00", end: "02:00" }, null)).toBe(false);
    expect(widens(null, null)).toBe(false);
  });

  it("is due once its time has come", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(isDue(null, now)).toBe(false);
    expect(isDue(new Date("2026-11-16T12:00:01Z"), now)).toBe(false);
    expect(isDue(now, now)).toBe(true);
  });
});
