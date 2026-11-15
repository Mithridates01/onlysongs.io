"use client";

import { useEffect, useRef, useState } from "react";
import type { AllowedShowView, SearchHitView, StatusResponse } from "@/lib/types";
import { useSpotifySearch } from "./useSpotifySearch";

// Changes save on their own once edits pause, so nothing waits on a button.
const SAVE_DELAY_MS = 600;

type SaveState = "idle" | "saving" | "saved" | "error";

const ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function SettingsForm({ initial }: { initial: StatusResponse }) {
  // The device's zone is only known in the browser, so it joins the list after
  // mount; reading it during render made server and client HTML differ.
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  useEffect(() => setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const zones = [...new Set([...(browserZone ? [browserZone] : []), initial.timeZone, ...ZONES])];
  const [interval, setIntervalSeconds] = useState(initial.intervalSeconds);
  const [podcasts, setPodcasts] = useState(initial.blockPodcasts);
  const [audiobooks, setAudiobooks] = useState(initial.blockAudiobooks);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [quietOn, setQuietOn] = useState(Boolean(initial.quietHours));
  const [start, setStart] = useState(initial.quietHours?.start ?? "06:00");
  const [end, setEnd] = useState(initial.quietHours?.end ?? "08:00");
  const [shows, setShows] = useState<AllowedShowView[]>(initial.allowedShows);
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const { hits, setHits, searching } = useSpotifySearch("show", query, true, setError);

  const body = JSON.stringify({
    intervalSeconds: interval,
    blockPodcasts: podcasts,
    blockAudiobooks: audiobooks,
    timeZone,
    quietHours: quietOn ? { start, end } : null,
    allowedShows: shows,
  });
  const savedBody = useRef(body);
  const latest = useRef(0);

  async function save(next: string, keepalive = false) {
    const id = ++latest.current;
    setSaveState("saving");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: next,
        keepalive,
      });
      const data = (await response.json()) as { error?: string; warning?: string | null };
      // A newer save owns the status line.
      if (id !== latest.current) return;
      if (!response.ok) {
        setError(data.error ?? "Could not save settings.");
        setSaveState("error");
        return;
      }
      savedBody.current = next;
      setError("");
      setWarning(data.warning ?? "");
      setSaveState("saved");
    } catch {
      if (id === latest.current) {
        setError("Could not reach the server, so that change isn’t saved yet. It will retry on your next change.");
        setSaveState("error");
      }
    }
  }

  // Saves after edits pause. Leaving the page before then still sends the
  // change (keepalive), so navigating away never drops it.
  useEffect(() => {
    if (body === savedBody.current) return;
    const timer = window.setTimeout(() => void save(body), SAVE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
    // save is recreated each render; body is the only input that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  const pendingBody = useRef(body);
  pendingBody.current = body;
  useEffect(() => {
    const flush = () => {
      if (pendingBody.current !== savedBody.current) void save(pendingBody.current, true);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // Runs once: flushes on unmount and on tab close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addShow(hit: SearchHitView) {
    setShows((current) => (current.some((show) => show.id === hit.id) ? current : [...current, { id: hit.id, name: hit.title }]));
    setHits([]);
    setQuery("");
  }

  async function addPasted() {
    setError("");
    const response = await fetch("/api/spotify/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: paste, purpose: "show" }),
    });
    const data = (await response.json()) as { hit?: SearchHitView; error?: string };
    if (!response.ok || !data.hit) {
      setError(data.error ?? "Could not read that show link.");
      return;
    }
    addShow(data.hit);
    setPaste("");
  }

  return (
    <>
      <p className="eyebrow">How it behaves</p>
      <h1 className="page-title">Settings</h1>
      <p className="lede">
        Spotify does not push playback changes, so some of a podcast will always play before the swap. At {interval} seconds,
        expect about {Math.round(interval / 2)} seconds on average. Shorter intervals catch episodes sooner and spend more of
        your Spotify quota. Anything under 5 seconds is rejected.
      </p>
      <p className="help save-status" aria-live="polite">
        {saveState === "saving"
          ? "Saving…"
          : saveState === "saved"
            ? "All changes saved."
            : saveState === "error"
              ? ""
              : "Changes save automatically."}
      </p>
      {error ? <p className="error">{error}</p> : null}
      {warning ? <p className="banner">{warning}</p> : null}
      <form onSubmit={(event) => event.preventDefault()} className="grid">
        <div className="grid two even">
          <section className="card">
            <h2>Polling</h2>
            <label className="field">
              <span>Check every {interval} seconds</span>
              <input
                type="range"
                min={5}
                max={300}
                step={5}
                value={interval}
                onChange={(event) => setIntervalSeconds(Number(event.target.value))}
              />
            </label>
            <label className="row">
              <input type="checkbox" checked={podcasts} onChange={(event) => setPodcasts(event.target.checked)} />
              Block podcasts
            </label>
            <label className="row">
              <input type="checkbox" checked={audiobooks} onChange={(event) => setAudiobooks(event.target.checked)} />
              Block audiobooks
            </label>
            <label className="field">
              <span>Time zone for quiet hours and “today”</span>
              <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="card">
            <h2>Quiet hours</h2>
            <label className="row">
              <input type="checkbox" checked={quietOn} onChange={(event) => setQuietOn(event.target.checked)} />
              Allow podcasts and audiobooks during a daily window
            </label>
            <div className="row" style={{ marginTop: 12 }}>
              <label className="field">
                <span>From</span>
                <input type="time" value={start} disabled={!quietOn} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label className="field">
                <span>Until</span>
                <input type="time" value={end} disabled={!quietOn} onChange={(event) => setEnd(event.target.value)} />
              </label>
            </div>
            <p className="help">Example: 06:00 to 08:00 lets a morning show play. Outside that window, the blocker resumes.</p>
          </section>
        </div>
        <section className="card">
          <h2>Allow list</h2>
          <p className="help">One list for shows and audiobooks. A match is left playing.</p>
          {shows.length === 0 ? <p className="help">Nothing on the list yet.</p> : null}
          <ul className="steps">
            {shows.map((show) => (
              <li key={show.id} className="spread">
                <span>{show.name}</span>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setShows((current) => current.filter((item) => item.id !== show.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            <input
              className="inline-input"
              style={{ flex: 1 }}
              type="search"
              placeholder="Search shows"
              aria-label="Search shows"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter would submit the settings form mid-search.
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </div>
          {searching ? <p className="help" aria-live="polite">Searching…</p> : null}
          <div className="hits">
            {hits.map((hit) => (
              <button key={hit.id} className="hit" type="button" onClick={() => addShow(hit)}>
                <span>
                  {hit.title}
                  <small>{hit.subtitle}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <input
              className="inline-input"
              style={{ flex: 1 }}
              placeholder="Paste a show, episode, or audiobook link"
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addPasted();
                }
              }}
            />
            <button className="btn ghost" type="button" onClick={addPasted}>
              Add link
            </button>
          </div>
        </section>
      </form>
    </>
  );
}
