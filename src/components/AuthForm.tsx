"use client";

import Link from "next/link";
import { useState } from "react";
import { openSpotifyDashboard } from "@/lib/links";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const signup = mode === "signup";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    // A server error can arrive with an empty or HTML body; show a message instead of crashing.
    const data = (await response.json().catch(() => ({}))) as { error?: string; next?: string };
    if (!response.ok || !data.next) {
      setError(data.error ?? (response.ok ? "Something went wrong." : "The server could not sign you in. Try again in a moment."));
      setPending(false);
      return;
    }
    if (data.next === "/onboarding") openSpotifyDashboard();
    window.location.href = data.next;
  }

  return (
    <main className="app">
      <Link href="/" className="brand">
        <small>onlysongs.io</small>
        <strong>OnlySongs</strong>
      </Link>
      <h1 className="page-title" style={{ marginTop: 28 }}>
        {signup ? "Create your account" : "Welcome back"}
      </h1>
      <p className="lede">{signup ? "Then you will connect a Spotify app that belongs to you." : "Sign in to OnlySongs."}</p>
      <form onSubmit={submit} className="card" style={{ maxWidth: 460 }}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            value={password}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Working…" : signup ? "Create account" : "Sign in"}
        </button>
        <p className="help">
          {signup ? (
            <>
              Already have an account? <Link href="/login">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link href="/signup">Create an account</Link> · <Link href="/forgot-password">Forgot password?</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
