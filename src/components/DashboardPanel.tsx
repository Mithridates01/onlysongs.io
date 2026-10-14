"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { outcomeLabel } from "@/lib/outcomes";
import type { SearchHitView, StatusResponse } from "@/lib/types";

export function DashboardPanel({ initial }: { initial: StatusResponse }) {
  const [status, setStatus] = useState(initial);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"track" | "playlist" | "album">("track");
  const [hits, setHits] = useState<SearchHitView[]>([]);
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function refresh() {
    const response = await fetch("/api/status");
    if (!response.ok) return;
    setStatus((await response.json()) as StatusResponse);
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const readySong = Boolean(status.replacement);
  const readySpotify = status.connection === "connected" || status.connection === "quota_paused";

  async function toggle() {
    setError("");
    setPending(true);
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !status.blockerEnabled }),
    });
    const data = (await response.json()) as { error?: string; warning?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? "Could not update the blocker.");
      return;
    }
    if (data.warning) setError(data.warning);
    await refresh();
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch(`/api/spotify/search?type=${kind}&q=${encodeURIComponent(query)}`);
    const data = (await response.json()) as { hits?: SearchHitView[]; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Search failed.");
      setHits([]);
      return;
    }
    setHits(data.hits ?? []);
  }

  async function choose(hit: SearchHitView) {
    if (hit.kind !== "track" && hit.kind !== "playlist" && hit.kind !== "album") return;
    setPending(true);
    setError("");
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        replacement: {
          uri: hit.uri,
          kind: hit.kind,
          art: hit.art,
          label: hit.subtitle ? `${hit.title} — ${hit.subtitle}` : hit.title,
        },
      }),
    });
    const data = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? "Could not save that song.");
      return;
    }
    setHits([]);
    setQuery("");
    await refresh();
  }

  async function usePaste(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    const resolved = await fetch("/api/spotify/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: paste, purpose: "replacement" }),
    });
    const data = (await resolved.json()) as { hit?: SearchHitView; error?: string };
    setPending(false);
    if (!resolved.ok || !data.hit) {
      setError(data.error ?? "Could not read that link.");
      return;
    }
    setPaste("");
    await choose(data.hit);
  }

  async function checkNow() {
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/check", { method: "POST" });
    const data = (await response.json()) as { outcome?: string; detail?: string; error?: string; status?: StatusResponse };
    setPending(false);
    if (data.status) setStatus(data.status);
    else await refresh();
    if (!response.ok) {
      setError(data.detail ?? data.error ?? "Check failed.");
      return;
    }
    setMessage(outcomeLabel(data.outcome ?? "error"));
  }

  return (
    <>
      <h1 className="page-title">{status.blockerEnabled ? "Blocker is on" : "Blocker is off"}</h1>
      <p className="lede">
        {status.quietHoursActive
          ? "Quiet hours are active, so a podcast is allowed until the window ends."
          : `Checking about every ${status.intervalSeconds} seconds. A podcast can play until the next check.`}
      </p>
      {status.warnings.map((warning) => (
        <p key={warning} className={warning.includes("Reconnect") ? "banner bad" : "banner"}>
          {warning} {warning.includes("Reconnect") ? <Link href="/account">Open account</Link> : null}
        </p>
      ))}
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="banner good">{message}</p> : null}

      <div className="grid two">
        <section className="card">
          <div className="hero-row">
            <div>
              <h2>Playback watch</h2>
              <ConnectionPill status={status.connection} />
              <p className="help">Last check {status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString() : "has not run yet"}.</p>
              {status.lastError ? <p className="help">{status.lastError}</p> : null}
            </div>
            <button
              type="button"
              className={status.blockerEnabled ? "switch on" : "switch"}
              role="switch"
              aria-checked={status.blockerEnabled}
              aria-label="Blocker"
              disabled={pending || !readySong || !readySpotify}
              onClick={toggle}
            >
              <span className="knob" />
            </button>
          </div>
          {!readySpotify ? (
            <p className="help">
              <Link href="/onboarding">Connect Spotify</Link> before turning this on.
            </p>
          ) : null}
          {!readySong ? <p className="help">Pick a replacement below before turning this on.</p> : null}
          <div className="now" style={{ marginTop: 16 }}>
            {status.nowPlaying.art ? (
              // Spotify artwork is served from their CDN and does not need the image optimizer.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="art" src={status.nowPlaying.art} alt="" />
            ) : (
              <div className="art-ph" />
            )}
            <div>
              {status.nowPlaying.blocked ? <span className="pill rust">Podcast — blocked</span> : null}
              <strong style={{ display: "block" }}>{status.nowPlaying.title ?? "Nothing playing"}</strong>
              <span className="muted">{status.nowPlaying.subtitle ?? "The worker records this on each check."}</span>
            </div>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn secondary" type="button" onClick={checkNow} disabled={pending || !readySpotify}>
              {pending ? "Checking…" : "Check now"}
            </button>
            <Link className="btn ghost" href="/settings">
              Interval and allow list
            </Link>
          </div>
        </section>
        <section className="stats">
          <article className="card stat">
            <strong>{status.blockedToday}</strong>
            <span>Blocked today</span>
          </article>
          <article className="card stat">
            <strong>{status.blockedAllTime}</strong>
            <span>Blocked all time</span>
          </article>
          <article className="card stat">
            <strong>{status.worker.online ? "Up" : "Down"}</strong>
            <span>Worker</span>
          </article>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Replacement</h2>
        {status.replacement ? (
          <div className="now" style={{ marginBottom: 14 }}>
            {status.replacement.art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="art" src={status.replacement.art} alt="" />
            ) : (
              <div className="art-ph" />
            )}
            <div>
              <span className="pill">{status.replacement.kind}</span>
              <strong style={{ display: "block", marginTop: 6 }}>{status.replacement.label}</strong>
              <span className="mono">{status.replacement.uri}</span>
            </div>
          </div>
        ) : (
          <p className="help">Search Spotify, or paste a track, playlist, or album link.</p>
        )}
        <form onSubmit={search} className="row">
          <select className="inline-input" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Replacement type">
            <option value="track">Track</option>
            <option value="playlist">Playlist</option>
            <option value="album">Album</option>
          </select>
          <input
            className="inline-input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Search Spotify"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="btn secondary" type="submit" disabled={!readySpotify}>
            Search
          </button>
        </form>
        <div className="hits">
          {hits.map((hit) => (
            <button key={hit.uri} type="button" className="hit" onClick={() => choose(hit)}>
              {hit.art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="art sm" src={hit.art} alt="" />
              ) : (
                <div className="art-ph sm" />
              )}
              <span>
                {hit.title}
                <small>{hit.subtitle}</small>
              </span>
            </button>
          ))}
        </div>
        <form onSubmit={usePaste} className="row" style={{ marginTop: 12 }}>
          <input
            className="inline-input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="https://open.spotify.com/track/…"
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
          />
          <button className="btn ghost" type="submit" disabled={pending || !readySpotify}>
            Use link
          </button>
        </form>
      </section>
    </>
  );
}

function ConnectionPill({ status }: { status: StatusResponse["connection"] }) {
  const map = {
    connected: ["good", "Connected"],
    broken: ["bad", "Reconnect Spotify"],
    quota_paused: ["warn", "Quota paused"],
    needs_connect: ["warn", "Credentials saved"],
    disconnected: ["", "Not connected"],
  } as const;
  const [tone, label] = map[status];
  return <span className={tone ? `pill ${tone}` : "pill"}>{label}</span>;
}
