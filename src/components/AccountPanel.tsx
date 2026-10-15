"use client";

import { useState } from "react";
import type { StatusResponse } from "@/lib/types";
import { CopyButton } from "./CopyButton";

export function AccountPanel({ initial }: { initial: StatusResponse }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function saveCredentials(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/spotify/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    const data = (await response.json()) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? "Could not save credentials.");
      return;
    }
    setClientSecret("");
    setMessage("Credentials replaced. Connect Spotify again.");
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Spotify and delete the saved tokens and app credentials?")) return;
    setPending(true);
    const response = await fetch("/api/spotify/disconnect", { method: "POST" });
    setPending(false);
    if (!response.ok) {
      setError("Could not disconnect.");
      return;
    }
    window.location.href = "/onboarding";
  }

  async function signOutOthers() {
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/auth/logout?scope=others", { method: "POST" });
    const data = (await response.json()) as { ended?: number; error?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? "Could not sign out other devices.");
      return;
    }
    const ended = data.ended ?? 0;
    setMessage(ended ? `Signed out ${ended} other session${ended === 1 ? "" : "s"}.` : "No other devices were signed in.");
  }

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    if (confirm.trim().toLowerCase() !== initial.email) {
      setError("Type your email to confirm deletion.");
      return;
    }
    setPending(true);
    const response = await fetch("/api/account", { method: "DELETE" });
    if (!response.ok) {
      setPending(false);
      setError("Could not delete the account.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <>
      <h1 className="page-title">Account</h1>
      <p className="lede">Secrets stay on the server. This page shows only the last four characters of the Client ID.</p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="banner good">{message}</p> : null}
      <div className="grid two">
        <section className="card">
          <h2>Spotify</h2>
          <p>
            Status: <strong>{initial.connection.replaceAll("_", " ")}</strong>
          </p>
          <p className="help">Client ID ····{initial.clientIdLast4 ?? "none"}</p>
          <p className="help">Spotify user {initial.spotifyUserId ?? "not connected"}</p>
          <div className="copyline" style={{ margin: "12px 0" }}>
            <code className="mono">{initial.redirectUri}</code>
            <CopyButton value={initial.redirectUri} />
          </div>
          <div className="row">
            <a className="btn" href="/api/spotify/connect">
              Reconnect Spotify
            </a>
            <button className="btn ghost" type="button" onClick={disconnect} disabled={pending}>
              Disconnect
            </button>
          </div>
        </section>
        <section className="card">
          <h2>Replace app credentials</h2>
          <form onSubmit={saveCredentials}>
            <label className="field">
              <span>New Client ID</span>
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} required />
            </label>
            <label className="field">
              <span>New Client Secret</span>
              <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} required />
            </label>
            <button className="btn secondary" type="submit" disabled={pending}>
              Save and require reconnect
            </button>
          </form>
        </section>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Signed-in devices</h2>
        <p className="help">Signs out every other browser and device. This one stays signed in.</p>
        <button className="btn secondary" type="button" onClick={signOutOthers} disabled={pending}>
          Sign out other devices
        </button>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Delete everything</h2>
        <p className="help">This removes your account, tokens, settings, and activity from this server.</p>
        <form onSubmit={deleteAccount}>
          <label className="field">
            <span>Type {initial.email} to confirm</span>
            <input value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </label>
          <button className="btn danger" type="submit" disabled={pending}>
            Delete account
          </button>
        </form>
      </section>
    </>
  );
}
