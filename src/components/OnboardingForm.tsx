"use client";

import { useState } from "react";
import { SPOTIFY_DASHBOARD_URL, startSpotifyConnect } from "@/lib/links";
import { CopyButton } from "./CopyButton";

const ERRORS: Record<string, string> = {
  access_denied: "Spotify sign-in was cancelled. Try connecting again.",
  invalid_grant: "That Spotify sign-in expired. Connect again.",
  state: "The Spotify sign-in didn’t match this session. Connect again.",
  missing_code: "Spotify didn’t return a sign-in code. Connect again.",
  token: "Spotify rejected the Client ID, the Client secret, or the redirect URI. Check them and save again.",
};

const STEPS = [
  { title: "Open Spotify", hint: "Sign in to the developer dashboard" },
  { title: "Create an app", hint: "Three things to copy" },
  { title: "Paste your keys", hint: "Client ID and secret" },
  { title: "Connect", hint: "Approve access in Spotify" },
] as const;

const APP_NAME = "OnlySongs";
const APP_DESCRIPTION = "Swaps podcasts for my music";

function firstStep(saved: boolean, errorCode?: string): number {
  if (errorCode === "token") return 3;
  if (errorCode) return 4;
  return saved ? 4 : 1;
}

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
  const [saved, setSaved] = useState(clientIdLast4);
  const [step, setStep] = useState(() => firstStep(Boolean(clientIdLast4), errorCode));
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState(errorCode ? (ERRORS[errorCode] ?? "Spotify sign-in failed. Connect again.") : "");
  const [pending, setPending] = useState(false);

  const idLooksRight = /^[0-9a-f]{32}$/i.test(clientId.trim());

  async function saveKeys(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/spotify/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; clientIdLast4?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? "Could not save those keys.");
      return;
    }
    setSaved(data.clientIdLast4 ?? null);
    setClientSecret("");
    setStep(4);
  }

  if (connected) {
    return (
      <div className="page stack">
        <div>
          <p className="eyebrow">All set</p>
          <h1 className="page-title">Spotify is connected</h1>
          <p className="lede">Pick the song you want to come back to, then turn the blocker on.</p>
        </div>
        <div className="row">
          <a className="btn" href="/dashboard">
            Go to Today
          </a>
          <button type="button" className="btn secondary" onClick={startSpotifyConnect}>
            Reconnect Spotify
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 40, alignItems: "flex-start" }}>
      <nav aria-label="Setup steps" style={{ flex: "1 1 240px", minWidth: 0 }}>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          {STEPS.map((item, index) => {
            const n = index + 1;
            const done = n < step || (n === 3 && Boolean(saved) && step !== 3);
            const current = n === step;
            return (
              <li key={item.title}>
                <button
                  type="button"
                  onClick={() => setStep(n)}
                  aria-current={current ? "step" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    width: "100%",
                    minHeight: 64,
                    padding: "10px 14px",
                    border: 0,
                    borderRadius: 18,
                    background: current ? "var(--surface)" : "transparent",
                    color: "var(--text)",
                    textAlign: "left",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flex: "none",
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      font: "500 13px var(--mono)",
                      ...(done
                        ? { background: "var(--accent)", color: "var(--accent-ink)" }
                        : current
                          ? { border: "1px solid var(--accent)", color: "var(--accent-text)" }
                          : { border: "1px solid var(--line-strong)", color: "var(--muted)" }),
                    }}
                  >
                    {done ? "✓" : n}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 15, fontWeight: 500 }}>{item.title}</span>
                    <span className="help" style={{ fontSize: 13 }}>
                      {item.hint}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className="card" aria-live="polite" style={{ flex: "999 1 560px", padding: "clamp(28px, 4vw, 44px)", gap: 24 }}>
        {error ? <p className="banner bad">{error}</p> : null}

        {step === 1 ? (
          <>
            <div>
              <p className="eyebrow">Step 1 of 4</p>
              <h1 className="page-title" style={{ fontSize: "clamp(30px, 3.6vw, 42px)", fontWeight: 300 }}>
                Open Spotify’s developer dashboard
              </h1>
              <p className="lede" style={{ margin: 0 }}>
                You’ll make a small app there that belongs to you. It’s free, and it’s how OnlySongs is allowed to change what’s playing.
                Sign in with the same Spotify account you listen on.
              </p>
            </div>
            <div className="row">
              <a className="btn" href={SPOTIFY_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
                Open the Spotify dashboard ↗
              </a>
              <button type="button" className="btn secondary" onClick={() => setStep(2)}>
                I’m signed in
              </button>
            </div>
            <p className="help">It opens in a new tab. Keep this one open.</p>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div>
              <p className="eyebrow">Step 2 of 4</p>
              <h1 className="page-title" style={{ fontSize: "clamp(30px, 3.6vw, 42px)", fontWeight: 300 }}>
                Create an app
              </h1>
              <p className="lede" style={{ margin: 0 }}>
                Click <strong style={{ color: "var(--text)", fontWeight: 500 }}>Create app</strong> in Spotify and fill in the form with these. The
                redirect URI must match exactly.
              </p>
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <CopyRow label="App name" value={APP_NAME} />
              <CopyRow label="App description" value={APP_DESCRIPTION} />
              <CopyRow label="Redirect URI · must match exactly" value={redirectUri} highlight />
            </div>
            <div className="inset" style={{ borderStyle: "dashed", display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="help">Then, in the same form:</span>
              <span style={{ color: "var(--body)" }}>
                → Under “Which API/SDKs are you planning to use?”, tick <strong style={{ color: "var(--text)", fontWeight: 500 }}>Web API</strong>.
              </span>
              <span style={{ color: "var(--body)" }}>
                → Accept Spotify’s terms and press <strong style={{ color: "var(--text)", fontWeight: 500 }}>Save</strong>.
              </span>
            </div>
            <div className="row">
              <button type="button" className="btn" onClick={() => setStep(3)}>
                I’ve created the app
              </button>
              <button type="button" className="btn secondary" onClick={() => setStep(1)}>
                Back
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <form onSubmit={saveKeys} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <p className="eyebrow">Step 3 of 4</p>
              <h1 className="page-title" style={{ fontSize: "clamp(30px, 3.6vw, 42px)", fontWeight: 300 }}>
                Paste your two keys
              </h1>
              <p className="lede" style={{ margin: 0 }}>
                In your new app, open <strong style={{ color: "var(--text)", fontWeight: 500 }}>Settings</strong>. Copy the Client ID, then click{" "}
                <strong style={{ color: "var(--text)", fontWeight: 500 }}>View client secret</strong> and copy that too.
              </p>
            </div>
            {saved ? <p className="help">Keys ending in ····{saved} are saved. Saving new ones replaces them.</p> : null}
            <div style={{ maxWidth: 560 }}>
              <label className="field">
                <span>Client ID</span>
                <input
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  aria-describedby="id-check"
                  style={{ fontFamily: "var(--mono)" }}
                />
              </label>
              <p id="id-check" className="help" style={{ marginTop: -8, minHeight: 21, color: idLooksRight ? "var(--accent-text)" : undefined }}>
                {clientId.trim() === "" ? "" : idLooksRight ? "✓ Looks like a Spotify Client ID" : "A Client ID is 32 letters and numbers."}
              </p>
              <label className="field">
                <span>Client secret</span>
                <input value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} type="password" autoComplete="off" required />
              </label>
              <p className="help" style={{ marginTop: -8 }}>
                Encrypted as soon as you save. Nobody, including you, will see it here again.
              </p>
            </div>
            <div className="row">
              <button type="submit" className="btn" disabled={pending}>
                {pending ? "Saving…" : "Save keys"}
              </button>
              <button type="button" className="btn secondary" onClick={() => setStep(2)}>
                Back
              </button>
            </div>
          </form>
        ) : null}

        {step === 4 ? (
          <>
            <div>
              <p className="eyebrow">Step 4 of 4</p>
              <h1 className="page-title" style={{ fontSize: "clamp(30px, 3.6vw, 42px)", fontWeight: 300 }}>
                Connect your Spotify account
              </h1>
              <p className="lede" style={{ margin: 0 }}>
                Spotify will ask you to approve three things. OnlySongs uses them only to swap podcasts for your song.
              </p>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
              <li className="inset">See what’s playing, to spot a podcast</li>
              <li className="inset">Start your song on the same device</li>
              <li className="inset">See your devices, so the swap lands in the right place</li>
            </ul>
            <div className="row">
              <button type="button" className="btn" onClick={startSpotifyConnect} disabled={!saved}>
                Connect Spotify
              </button>
              <button type="button" className="btn secondary" onClick={() => setStep(3)}>
                Back
              </button>
            </div>
            {!saved ? <p className="help">Save your keys in step 3 first.</p> : null}
            <p className="help">You can disconnect at any time from your account page.</p>
          </>
        ) : null}
      </section>
    </div>
  );
}

function CopyRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="inset spread" style={highlight ? { borderColor: "rgba(180,168,245,.4)" } : undefined}>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 13, color: highlight ? "var(--accent-text)" : "var(--muted)" }}>{label}</span>
        <span className="mono" style={{ fontSize: 15, color: "var(--text)" }}>
          {value}
        </span>
      </div>
      <CopyButton value={value} />
    </div>
  );
}
