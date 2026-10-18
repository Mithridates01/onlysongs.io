"use client";

import Link from "next/link";
import { Brand } from "./Brand";
import { useState } from "react";

function Frame({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <main className="app">
      <header className="topbar">
        <Brand />
      </header>
      <div style={{ maxWidth: 460, margin: "clamp(8px, 4vw, 48px) auto 0", display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 className="page-title" style={{ fontSize: 40, fontWeight: 300 }}>
          {title}
        </h1>
        <p className="lede">{lede}</p>
        <div className="card">{children}</div>
      </div>
    </main>
  );
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: response.ok, error: data.error };
}

export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState("");

  async function confirm() {
    setState("pending");
    setError("");
    const result = await post("/api/auth/verify-email", { token });
    if (!result.ok) {
      setError(result.error ?? "Could not confirm the email.");
      setState("idle");
      return;
    }
    setState("done");
  }

  return (
    <Frame title="Confirm your email" lede="One click and this address is confirmed for your account.">
      {state === "done" ? (
        <p className="banner good">
          Email confirmed. <Link href="/dashboard">Go to the dashboard</Link>
        </p>
      ) : (
        <>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn" type="button" onClick={confirm} disabled={!token || state === "pending"}>
            {state === "pending" ? "Confirming…" : "Confirm email"}
          </button>
        </>
      )}
    </Frame>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("pending");
    setError("");
    const result = await post("/api/auth/password/forgot", { email });
    if (!result.ok) {
      setError(result.error ?? "Could not send the email.");
      setState("idle");
      return;
    }
    setState("sent");
  }

  return (
    <Frame title="Reset your password" lede="Enter your account email and we will send a reset link.">
      {state === "sent" ? (
        <p className="banner good">If an account uses that email, a reset link is on its way. It expires in 1 hour.</p>
      ) : (
        <form onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn" type="submit" disabled={state === "pending"}>
            {state === "pending" ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="help">
        <Link href="/login">Back to sign in</Link>
      </p>
    </Frame>
  );
}

export function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("pending");
    setError("");
    const result = await post("/api/auth/password/reset", { token, password });
    if (!result.ok) {
      setError(result.error ?? "Could not reset the password.");
      setState("idle");
      return;
    }
    setState("done");
  }

  return (
    <Frame title="Choose a new password" lede="This signs you out on every device.">
      {state === "done" ? (
        <p className="banner good">
          Password changed. <Link href="/login">Sign in</Link>
        </p>
      ) : (
        <form onSubmit={submit}>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn" type="submit" disabled={!token || state === "pending"}>
            {state === "pending" ? "Saving…" : "Set password"}
          </button>
        </form>
      )}
    </Frame>
  );
}

export function VerifyBanner() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function resend() {
    setPending(true);
    const result = await post("/api/auth/verify-email/resend", {});
    setPending(false);
    setMessage(result.ok ? "Sent. Check your inbox." : (result.error ?? "Could not send the email."));
  }

  return (
    <p className="banner">
      Confirm your email so you can reset your password if you forget it.{" "}
      {message || (
        <button type="button" className="linkish" onClick={resend} disabled={pending}>
          Resend the link
        </button>
      )}
    </p>
  );
}
