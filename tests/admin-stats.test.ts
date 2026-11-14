import { describe, expect, it } from "vitest";
import { buildSeries } from "../src/lib/admin-stats";

describe("buildSeries", () => {
  it("gives one point per UTC day ending today, with a running account total", () => {
    const series = buildSeries({
      days: 3,
      now: new Date("2026-10-18T23:30:00Z"),
      before: 5,
      joinedByDay: new Map([
        ["2026-10-16", 2],
        ["2026-10-18", 1],
      ]),
      activeByDay: new Map([["2026-10-17", 4]]),
    });
    expect(series).toEqual([
      { day: "2026-10-16", total: 7, joined: 2, active: 0 },
      { day: "2026-10-17", total: 7, joined: 0, active: 4 },
      { day: "2026-10-18", total: 8, joined: 1, active: 0 },
    ]);
  });

  it("ignores counts outside the window", () => {
    const series = buildSeries({
      days: 2,
      now: new Date("2026-10-18T00:00:00Z"),
      before: 0,
      joinedByDay: new Map([["2026-01-01", 9]]),
      activeByDay: new Map([["2026-01-01", 9]]),
    });
    expect(series.map((point) => point.total)).toEqual([0, 0]);
    expect(series.map((point) => point.active)).toEqual([0, 0]);
  });
});
