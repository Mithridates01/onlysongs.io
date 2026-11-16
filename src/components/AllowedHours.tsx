"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { widens } from "@/lib/delay";
import { toMinutes, zoneParts } from "@/lib/quiet-hours";
import type { StatusResponse } from "@/lib/types";
import { LocalTime } from "./LocalTime";

type Window = { start: string; end: string };

const DAY = 24 * 60;

// "06:00" → "6 am", "18:30" → "6:30 pm".
export function clockLabel(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute ? `${twelve}:${String(minute).padStart(2, "0")} ${suffix}` : `${twelve} ${suffix}`;
}

// A window as up to two spans of the day, in percent, split at midnight.
function spans(window: Window): { left: number; width: number }[] {
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  const pct = (minutes: number) => (minutes / DAY) * 100;
  if (start < end) return [{ left: pct(start), width: pct(end - start) }];
  return [
    { left: pct(start), width: pct(DAY - start) },
    { left: 0, width: pct(end) },
  ].filter((span) => span.width > 0);
}

const same = (a: Window | null, b: Window | null) => (a?.start ?? null) === (b?.start ?? null) && (a?.end ?? null) === (b?.end ?? null);

export function AllowedHours({ status, onSaved, onError }: { status: StatusResponse; onSaved: () => Promise<void>; onError: (text: string) => void }) {
  const saved = status.quietHours;
  const pending = status.pendingQuietHours ? { start: status.pendingQuietHours.start, end: status.pendingQuietHours.end } : null;
  // The form starts from what will be in force once anything waiting applies.
  const target = pending ?? saved;
  const [on, setOn] = useState(Boolean(target));
  const [start, setStart] = useState(target?.start ?? "06:00");
  const [end, setEnd] = useState(target?.end ?? "08:00");
  const [busy, setBusy] = useState(false);
  const [nowMinute, setNowMinute] = useState<number | null>(null);

  useEffect(() => {
    setOn(Boolean(target));
    if (target) {
      setStart(target.start);
      setEnd(target.end);
    }
    // Reset the form only when the stored target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.start, target?.end]);

  // The current time in the account's zone, known only in the browser.
  useEffect(() => {
    const tick = () => {
      const parts = zoneParts(new Date(), status.timeZone);
      setNowMinute(parts.hour * 60 + parts.minute);
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [status.timeZone]);

  const draft: Window | null = on && start && end ? { start, end } : null;
  const invalid = on && start === end;
  const dirty = !same(draft, target);
  const running = status.blockerEnabled && (status.connection === "connected" || status.connection === "quota_paused");
  const waits = running && widens(saved, draft);

  async function save(next: Window | null) {
    setBusy(true);
    onError("");
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quietHours: next }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!response?.ok) {
      onError(data?.error ?? "Could not save your allowed hours.");
      return;
    }
    await onSaved();
  }

  const state = !saved ? "Off" : status.quietHoursActive ? "Allowed now" : "Blocking now";

  return (
    <section className="card" aria-labelledby="hours-h">
      <div className="spread">
        <h2 id="hours-h" className="label">
          Allowed hours
        </h2>
        <span className={saved && status.quietHoursActive ? "pill good" : "pill"}>{state}</span>
      </div>
      <p className="help" style={{ margin: 0 }}>
        A daily window when podcasts and audiobooks can play. Outside it, your song comes back.
      </p>

      <div>
        <div className="day-bar" role="img" aria-label={saved ? `Allowed ${clockLabel(saved.start)} to ${clockLabel(saved.end)}` : "No allowed hours"}>
          {saved ? spans(saved).map((span) => <span key={span.left} className="day-span" style={{ left: `${span.left}%`, width: `${span.width}%` }} />) : null}
          {draft && !invalid && dirty
            ? spans(draft).map((span) => <span key={`d${span.left}`} className="day-span draft" style={{ left: `${span.left}%`, width: `${span.width}%` }} />)
            : pending
              ? spans(pending).map((span) => <span key={`p${span.left}`} className="day-span draft" style={{ left: `${span.left}%`, width: `${span.width}%` }} />)
              : null}
          {nowMinute !== null ? <span className="day-now" style={{ left: `${(nowMinute / DAY) * 100}%` }} title="Now" /> : null}
        </div>
        <div className="mono spread" style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>
          <span>12 am</span>
          <span>6 am</span>
          <span>12 pm</span>
          <span>6 pm</span>
          <span>12 am</span>
        </div>
      </div>

      {pending && status.pendingQuietHours ? (
        <p className="banner" style={{ margin: 0 }}>
          Changing to {clockLabel(pending.start)}–{clockLabel(pending.end)} at <LocalTime iso={status.pendingQuietHours.at} />.{" "}
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void save(saved)} style={{ padding: "2px 10px", minHeight: 0 }}>
            Cancel
          </button>
        </p>
      ) : null}

      <div className="row" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Daily allowed hours"
          className={on ? "switch on" : "switch"}
          onClick={() => setOn((value) => !value)}
          disabled={busy}
        >
          <span className="knob" />
        </button>
        <label className="field" style={{ margin: 0 }}>
          <span>From</span>
          <input type="time" value={start} disabled={!on || busy} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span>Until</span>
          <input type="time" value={end} disabled={!on || busy} onChange={(event) => setEnd(event.target.value)} />
        </label>
        {dirty ? (
          <button type="button" className="btn" disabled={busy || invalid} onClick={() => void save(draft)}>
            {busy ? "Saving…" : waits ? "Save · starts in 1 hour" : "Save"}
          </button>
        ) : null}
      </div>
      <p className="help" style={{ margin: 0 }}>
        {invalid
          ? "Pick a start and end that differ."
          : dirty && waits
            ? "More allowed time waits an hour while the blocker is on. Less allowed time applies right away."
            : `Times are in ${status.timeZone}. `}
        {!invalid && !(dirty && waits) ? <Link href="/settings">Change time zone</Link> : null}
      </p>
    </section>
  );
}
