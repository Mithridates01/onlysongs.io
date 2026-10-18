"use client";

import { useEffect, useState } from "react";
import type { AllowedShowView, SearchHitView, StatusResponse } from "@/lib/types";

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
  const [hits, setHits] = useState<SearchHitView[]>([]);
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intervalSeconds: interval,
        blockPodcasts: podcasts,
        blockAudiobooks: audiobooks,
        timeZone,
        quietHours: quietOn ? { start, end } : null,
        allowedShows: shows,
      }),
    });
    const data = (await response.json()) as { error?: string; warning?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? "Could not save settings.");
      return;
    }
    setMessage(data.warning ?? "Settings saved.");
  }

  async function searchShows() {
    setError("");
    const response = await fetch(`/api/spotify/search?type=show&q=${encodeURIComponent(query)}`);
    const data = (await response.json()) as { hits?: SearchHitView[]; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Show search failed.");
      return;
    }
    setHits(data.hits ?? []);
  }

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
        your Spotify quota. Anything under 10 seconds is rejected.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="banner good">{message}</p> : null}
      <form onSubmit={save} className="grid">
        <section className="card">
          <h2>Polling</h2>
          <label className="field">
            <span>Check every {interval} seconds</span>
            <input
              type="range"
              min={10}
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
        <section className="card">
          <h2>Allow list</h2>
          <p className="help">One list for shows and audiobooks. A match is left playing. Save after you add or remove one.</p>
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
              placeholder="Search shows"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchShows();
                }
              }}
            />
            <button className="btn secondary" type="button" onClick={searchShows}>
              Search
            </button>
          </div>
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
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
      </form>
    </>
  );
}
