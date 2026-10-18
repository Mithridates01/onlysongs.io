"use client";

import Link from "next/link";
import { useState } from "react";
import { outcomeLabel } from "@/lib/outcomes";
import type { StatusResponse } from "@/lib/types";
import { LocalTime } from "./LocalTime";
import { ReplacementPicker } from "./ReplacementPicker";
import { useStatus } from "./useStatus";

export function DashboardPanel({ initial }: { initial: StatusResponse }) {
  const { status, setStatus, refresh } = useStatus(initial);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);

  const readySong = Boolean(status.replacement);
  const readySpotify = status.connection === "connected" || status.connection === "quota_paused";
  const on = status.blockerEnabled;
  const showPicker = picking || !readySong;

  async function toggle() {
    setError("");
    setPending(true);
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !on }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; warning?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? "Could not update the blocker.");
      return;
    }
    if (data.warning) setError(data.warning);
    await refresh();
  }

  async function checkNow() {
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/check", { method: "POST" });
    const data = (await response.json().catch(() => ({}))) as { outcome?: string; detail?: string; error?: string; status?: StatusResponse };
    setPending(false);
    if (data.status) setStatus(data.status);
    else await refresh();
    if (!response.ok) {
      setError(data.detail ?? data.error ?? "Check failed.");
      return;
    }
    setMessage(outcomeLabel(data.outcome ?? "error"));
  }

  const headline = !readySpotify
    ? "Connect Spotify to begin."
    : !readySong
      ? "Pick the song to come back to."
      : status.quietHoursActive
        ? "Quiet hours. Podcasts can play."
        : on
          ? "Only songs. Breathe easy."
          : "Podcasts can play for now.";
  const sub = !readySpotify
    ? "OnlySongs needs your Spotify app before it can listen."
    : !readySong
      ? "Search for a track, playlist or album below, then turn the blocker on."
      : status.quietHoursActive
        ? "Your quiet hours are on, so podcasts and audiobooks are allowed until the window ends."
        : on
          ? `If a podcast or audiobook starts, your song comes back within about ${status.intervalSeconds < 90 ? "a minute" : `${Math.round(status.intervalSeconds / 60)} minutes`}.`
          : "Turn the blocker on when you want to stay in the music.";
  const listening = on && readySpotify && readySong && !status.quietHoursActive;

  return (
    <>
      {status.warnings.map((warning) => {
        const reconnect = warning.text.includes("Reconnect");
        return (
          <p key={warning.text} className={reconnect ? "banner bad" : "banner"}>
            {warning.text}
            {warning.resumesAt ? (
              <>
                {" "}
                <LocalTime iso={warning.resumesAt} />.
              </>
            ) : null}{" "}
            {reconnect ? <Link href="/account">Open account</Link> : null}
          </p>
        );
      })}
      {error ? <p className="banner bad">{error}</p> : null}
      {message ? <p className="banner good">{message}</p> : null}

      <section aria-labelledby="status-h" className="hero-row" style={{ gap: "clamp(28px, 5vw, 64px)", padding: "clamp(8px, 3vw, 32px) 0 clamp(24px, 4vw, 48px)", justifyContent: "flex-start" }}>
        <div className="orb-wrap" style={{ flex: "0 1 280px", minWidth: 220, height: 280 }}>
          {listening ? <div className="orb-ring" style={{ width: 270, height: 270 }} /> : null}
          <div
            className={listening ? "orb" : "orb off"}
            role="img"
            aria-label={listening ? "Watching for podcasts" : "Not watching"}
            style={{ width: listening ? 250 : 210 }}
          />
        </div>
        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            {listening ? "Listening" : on ? "On hold" : "Paused"}
          </p>
          <h1 id="status-h" className="display" style={{ margin: 0, fontSize: "clamp(40px, 5.4vw, 66px)" }}>
            {headline}
          </h1>
          <p className="lede" style={{ margin: 0 }}>
            {sub}
          </p>
          <div className="row" style={{ marginTop: 4 }}>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              onClick={toggle}
              disabled={pending || !readySong || !readySpotify}
              className="btn secondary"
              style={{ minHeight: 52, padding: "6px 22px 6px 6px", gap: 14 }}
            >
              <span className={on ? "switch on" : "switch"} aria-hidden="true">
                <span className="knob" />
              </span>
              {on ? "Blocker on" : "Blocker off"}
            </button>
            <button className="btn secondary" type="button" onClick={checkNow} disabled={pending || !readySpotify} style={{ minHeight: 52 }}>
              {pending ? "Checking…" : "Check now"}
            </button>
            {!readySpotify ? (
              <Link className="btn" href="/onboarding" style={{ minHeight: 52 }}>
                Set up Spotify
              </Link>
            ) : null}
          </div>
          <p className="row mono" style={{ gap: "6px 18px", color: "var(--muted)", margin: 0 }}>
            <span>Every {status.intervalSeconds}s</span>
            <span>
              Last check <LocalTime iso={status.lastCheckedAt} fallback="not yet" />
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span className={status.worker.online ? "dot" : "dot apricot"} aria-hidden="true" />
              {status.worker.online ? "Worker running" : "Worker offline"}
            </span>
          </p>
        </div>
      </section>

      <div className="grid two">
        <section className="card" aria-labelledby="np-h">
          <div className="spread">
            <h2 id="np-h" className="label">
              Playing now
            </h2>
            <ConnectionPill status={status.connection} />
          </div>
          <div className="now">
            {status.nowPlaying.art ? (
              // Spotify artwork is served from their CDN and does not need the image optimizer.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="art" src={status.nowPlaying.art} alt="" />
            ) : (
              <div className="art-ph" />
            )}
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontFamily: "var(--display)", fontSize: 24, lineHeight: 1.15, letterSpacing: "-0.025em" }}>
                {status.nowPlaying.title ?? "Nothing playing"}
              </span>
              <span className="muted">{status.nowPlaying.subtitle ?? "Each check records what’s on."}</span>
              {status.nowPlaying.blocked ? (
                <span className="pill bad">
                  <span className="dot apricot" aria-hidden="true" />
                  Podcast · stepping aside
                </span>
              ) : status.nowPlaying.title ? (
                <span className="pill good">Music · left alone</span>
              ) : null}
            </div>
          </div>
          {status.lastError ? <p className="help">{status.lastError}</p> : null}
        </section>

        <section className="card stat" aria-labelledby="today-h">
          <h2 id="today-h" className="label">
            Kept you in the music
          </h2>
          <div className="row" style={{ alignItems: "baseline", gap: 14 }}>
            <strong>{status.blockedToday}</strong>
            <span style={{ fontSize: 16, color: "var(--body)" }}>{status.blockedToday === 1 ? "time today" : "times today"}</span>
          </div>
          <span>{status.blockedAllTime} since you started</span>
        </section>
      </div>

      <div className="stack" style={{ marginTop: 20 }}>
        {readySong && status.replacement ? (
          <section className="card" aria-labelledby="song-h">
            <div className="spread">
              <div className="now">
                {status.replacement.art ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="art sm" src={status.replacement.art} alt="" style={{ width: 64, height: 64 }} />
                ) : (
                  <div className="art-ph sm" style={{ width: 64, height: 64 }} />
                )}
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <h2 id="song-h" className="label">
                    Your song
                  </h2>
                  <span style={{ fontSize: 18, fontWeight: 500 }}>{status.replacement.label}</span>
                  <span className="help">{status.replacement.kind}</span>
                </div>
              </div>
              <button type="button" className="btn secondary" onClick={() => setPicking((open) => !open)} aria-expanded={picking}>
                {picking ? "Done" : "Change song"}
              </button>
            </div>
          </section>
        ) : null}

        {showPicker ? (
          <ReplacementPicker
            replacement={status.replacement}
            readySpotify={readySpotify}
            onSaved={async () => {
              setPicking(false);
              await refresh();
            }}
            onError={setError}
          />
        ) : null}

        {status.recent.length ? (
          <section className="card" aria-labelledby="recent-h" style={{ gap: 6 }}>
            <div className="spread" style={{ paddingBottom: 10 }}>
              <h2 id="recent-h" className="label">
                Recently swapped
              </h2>
              <Link href="/activity" style={{ fontSize: 14 }}>
                All activity
              </Link>
            </div>
            {status.recent.map((row) => (
              <div key={row.at} className="list-row">
                <span className="mono" style={{ width: 120, flex: "none", color: "var(--muted)" }}>
                  <LocalTime iso={row.at} />
                </span>
                <span className="dot apricot" aria-hidden="true" />
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <div style={{ fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.episodeName ?? "An episode"}</div>
                  <div className="help" style={{ fontSize: 13 }}>
                    {row.showName ?? "Podcast or audiobook"}
                  </div>
                </div>
                <span style={{ fontSize: 13, color: "var(--accent-text)" }}>Back to your song</span>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </>
  );
}

function ConnectionPill({ status }: { status: StatusResponse["connection"] }) {
  const map = {
    connected: ["good", "Connected"],
    broken: ["bad", "Reconnect Spotify"],
    quota_paused: ["warn", "Quota paused"],
    needs_connect: ["warn", "Finish connecting"],
    disconnected: ["", "Not connected"],
  } as const;
  const [tone, label] = map[status];
  return <span className={tone ? `pill ${tone}` : "pill"}>{label}</span>;
}
