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
          ? "Quiet hours are active, so podcasts and audiobooks are allowed until the window ends."
          : `Checking about every ${status.intervalSeconds} seconds. A blocked podcast or audiobook can play until the next check.`}
      </p>
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
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="banner good">{message}</p> : null}

      <div className="grid two">
        <section className="card">
          <div className="hero-row">
            <div>
              <h2>Playback watch</h2>
              <ConnectionPill status={status.connection} />
              <p className="help">
                Last check <LocalTime iso={status.lastCheckedAt} fallback="has not run yet" />.
              </p>
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

      <ReplacementPicker replacement={status.replacement} readySpotify={readySpotify} onSaved={refresh} onError={setError} />
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
