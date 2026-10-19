"use client";

import { useState } from "react";
import type { DayPoint } from "@/lib/admin-stats";

const RANGES = [7, 30, 90] as const;

// Three round gridline values from 0 up to just above the series' peak.
function ticks(max: number): { top: number; labels: number[] } {
  const step = Math.max(1, Math.ceil(Math.max(max, 1) / 3));
  return { top: step * 3, labels: [step * 3, step * 2, step, 0] };
}

function label(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function AdminCharts({ series, pending }: { series: DayPoint[]; pending: number }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [hover, setHover] = useState<number | null>(null);
  const data = series.slice(-range);
  const n = data.length;
  const shown = hover !== null && hover < n ? hover : n - 1;
  const today = data[n - 1];
  const joinedInRange = data.reduce((sum, point) => sum + point.joined, 0);
  const avgRaw = data.reduce((sum, point) => sum + point.active, 0) / n;
  const avgActive = Math.round(avgRaw);
  const avgLabel = avgRaw > 0 && avgActive === 0 ? "under 1 a day on average" : `${avgActive} a day on average`;
  const users = ticks(Math.max(...data.map((point) => point.total)));
  const active = ticks(Math.max(...data.map((point) => point.active)));
  const x = (i: number) => (n === 1 ? 300 : (i / (n - 1)) * 600);
  const y = (value: number) => 200 - (value / users.top) * 200;
  const line = "M" + data.map((point, i) => `${x(i).toFixed(1)} ${y(point.total).toFixed(1)}`).join(" L");
  const pct = n === 1 ? 0.5 : shown / (n - 1);

  return (
    <div className="stack">
      <div className="spread" style={{ alignItems: "flex-end" }}>
        <p className="help" style={{ margin: 0 }}>
          Days are in UTC.
        </p>
        <div className="seg" role="group" aria-label="Time range">
          {RANGES.map((value) => (
            <button key={value} type="button" aria-pressed={range === value} onClick={() => {
                setRange(value);
                setHover(null);
              }}>
              {value} days
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 20 }}>
        <section className="card stat" aria-label="Accounts">
          <h2 className="label">Accounts</h2>
          <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
            <strong style={{ color: "var(--text)" }}>{today.total}</strong>
            <span>
              +{joinedInRange} in {range} days
            </span>
          </div>
        </section>
        <section className="card stat" aria-label="Active today">
          <h2 className="label">Active today</h2>
          <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
            <strong>{today.active}</strong>
            <span>{avgLabel}</span>
          </div>
        </section>
        <section className="card stat" aria-label="Waiting for approval">
          <h2 className="label">Waiting for approval</h2>
          <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
            <strong style={{ color: "var(--text)" }}>{pending}</strong>
            <a href="#requests" style={{ fontSize: 14 }}>
              Review
            </a>
          </div>
        </section>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <ChartCard title="Accounts over time" readout={`${label(data[shown].day)} · ${data[shown].total} accounts`} ticks={users.labels} first={data[0].day} last={today.day}>
          <svg
            viewBox="0 0 600 200"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Accounts grew from ${data[0].total} to ${today.total} over ${range} days`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
          >
            <path d={`${line} L600 200 L0 200 Z`} fill="#B4A8F5" fillOpacity={0.1} />
            <path d={line} fill="none" stroke="#B4A8F5" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: `${pct * 100}%`, width: 1, background: "#3A3F52", pointerEvents: "none" }} />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              width: 10,
              height: 10,
              margin: "-5px 0 0 -5px",
              borderRadius: "50%",
              background: "#B4A8F5",
              boxShadow: "0 0 0 2px #13151C",
              pointerEvents: "none",
              left: `${pct * 100}%`,
              top: `${(1 - data[shown].total / users.top) * 100}%`,
            }}
          />
          <HoverStrip count={n} onHover={setHover} />
        </ChartCard>

        <ChartCard title="Daily active users" readout={`${label(data[shown].day)} · ${data[shown].active} active`} ticks={active.labels} first={data[0].day} last={today.day}>
          <div role="img" aria-label={`Daily active users over ${range} days, ${avgActive} a day on average`} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: n > 40 ? 1 : 2 }}>
            {data.map((point, i) => (
              <div
                key={point.day}
                style={{
                  flex: 1,
                  height: `${(point.active / active.top) * 100}%`,
                  minHeight: point.active ? 2 : 0,
                  borderRadius: "4px 4px 0 0",
                  background: "#B4A8F5",
                  opacity: i === shown ? 1 : 0.55,
                }}
              />
            ))}
          </div>
          <HoverStrip count={n} onHover={setHover} />
        </ChartCard>
      </div>
      <p className="help" style={{ margin: 0 }}>
        Someone counts once a day when they sign in or use the site. Background checks don’t count.
      </p>
    </div>
  );
}

function ChartCard(props: { title: string; readout: string; ticks: number[]; first: string; last: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ flex: "1 1 440px", minWidth: 0 }}>
      <div className="spread" style={{ alignItems: "baseline" }}>
        <h2>{props.title}</h2>
        <span className="mono" style={{ color: "var(--body)" }}>
          {props.readout}
        </span>
      </div>
      <div style={{ position: "relative", height: 220, paddingLeft: 36, paddingBottom: 24 }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: "0 0 24px 36px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          {props.ticks.map((tick) => (
            <div key={tick} style={{ position: "relative", borderTop: "1px solid var(--line)" }}>
              <span className="mono" style={{ position: "absolute", left: -36, top: -8, width: 28, textAlign: "right", fontSize: 11, color: "var(--faint)" }}>
                {tick}
              </span>
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", inset: "0 0 24px 36px" }}>{props.children}</div>
        <div aria-hidden="true" className="mono spread" style={{ position: "absolute", left: 36, right: 0, bottom: 0, fontSize: 11, color: "var(--faint)" }}>
          <span>{label(props.first)}</span>
          <span>{label(props.last)}</span>
        </div>
      </div>
    </section>
  );
}

// Invisible columns, one per day, wider than the marks, that drive the readout.
function HoverStrip({ count, onHover }: { count: number; onHover: (index: number | null) => void }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex" }} onMouseLeave={() => onHover(null)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ flex: 1 }} onMouseEnter={() => onHover(i)} />
      ))}
    </div>
  );
}
