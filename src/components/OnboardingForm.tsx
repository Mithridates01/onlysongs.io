"use client";

import { useEffect, useState } from "react";
import { SPOTIFY_DASHBOARD_URL, openSpotifyDashboard, spotifyDashboardAlreadyOpened, startSpotifyConnect } from "@/lib/links";
import { CopyButton } from "./CopyButton";

const ERRORS: Record<string, string> = {
  access_denied: "Spotify login was cancelled.",
  invalid_grant: "That Spotify login expired. Connect again.",
  state: "The Spotify login did not match this session. Connect again.",
  missing_code: "Spotify did not return a login code.",
  token: "Spotify rejected the Client ID, Client Secret, or redirect URI.",
};

export function OnboardingForm({
  redirectUri,
  clientIdLast4,
  errorCode,
  connected,
}: {
  redirectUri: string;
  clientIdLast4: string | null;
  errorCode?: string;
  connected: boolean;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [message, setMessage] = useState(errorCode ? ERRORS[errorCode] ?? "Spotify login failed." : "");
  const [saved, setSaved] = useState(clientIdLast4);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (connected || errorCode || spotifyDashboardAlreadyOpened()) return;
    openSpotifyDashboard();
  }, [connected, errorCode]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const response = await fetch("/api/spotify/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    const data = (await response.json()) as { error?: string; clientIdLast4?: string };
    setPending(false);
    if (!response.ok) {
      setMessage(data.error ?? "Could not save those credentials.");
      return;
    }
    setSaved(data.clientIdLast4 ?? null);
    setClientSecret("");
    setMessage("Credentials saved. Connect Spotify next. A bad secret fails on that step.");
  }

  return (
    <>
      <h1 className="page-title">Connect your Spotify app</h1>
      <p className="lede">
        Each person uses their own Spotify developer app. The dashboard opens in a new tab so these steps stay put.
        Spotify limits a development app to a handful of users, and playback control requires Premium.
      </p>
      {message ? <p className={message.startsWith("Credentials saved") ? "banner good" : "banner bad"}>{message}</p> : null}
      <div className="grid two">
        <section className="card">
          <h2>In the Spotify dashboard</h2>
          <p>
            <a className="btn" href={SPOTIFY_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
              Open Spotify dashboard
            </a>
          </p>
          <ol className="steps">
            <li>
              In the new tab, create an app at{" "}
              <a href={SPOTIFY_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
                developer.spotify.com/dashboard
              </a>
              .
            </li>
            <li>Add this redirect URI exactly. Spotify rejects a mismatch.</li>
          </ol>
          <div className="copyline">
            <code className="mono">{redirectUri}</code>
            <CopyButton value={redirectUri} />
          </div>
          <ol className="steps" start={3}>
            <li>Select Web API for the app.</li>
            <li>Copy the Client ID and Client Secret into the form.</li>
            <li>Save, then connect. Approve the playback permissions Spotify shows you.</li>
          </ol>
        </section>
        <section className="card">
          <h2>Your credentials</h2>
          {saved ? <p className="help">Saved client ID ending in {saved}. Saving again replaces it and requires a new connect.</p> : null}
          {connected ? <p className="banner good">Spotify is connected. You can pick a song on the dashboard.</p> : null}
          <form onSubmit={save}>
            <label className="field">
              <span>Client ID</span>
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" required />
            </label>
            <label className="field">
              <span>Client Secret</span>
              <input
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                type="password"
                autoComplete="off"
                required
              />
            </label>
            <div className="row">
              <button className="btn secondary" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save credentials"}
              </button>
              {saved ? (
                <button className="btn" type="button" onClick={startSpotifyConnect}>
                  Connect Spotify
                </button>
              ) : (
                <button className="btn" type="button" disabled>
                  Connect Spotify
                </button>
              )}
            </div>
            {!saved ? <p className="help">Save the Client ID and secret before connecting.</p> : null}
          </form>
        </section>
      </div>
    </>
  );
}
