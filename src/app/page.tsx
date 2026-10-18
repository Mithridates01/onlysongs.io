import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { currentSession } from "@/lib/http";

export const dynamic = "force-dynamic";

const icon = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "#C9C0FA", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export default async function HomePage() {
  const session = await currentSession();
  if (session) redirect("/dashboard");

  return (
    <main className="app landing">
      <header className="topbar">
        <Brand />
        <nav className="landing-nav row" aria-label="Primary" style={{ gap: "8px 22px" }}>
          <a className="navlink" href="#how">
            How it works
          </a>
          <a className="navlink" href="#setup">
            Setup
          </a>
          <Link className="navlink" href="/login" style={{ color: "var(--text)" }}>
            Sign in
          </Link>
          <Link className="btn sm" href="/signup">
            Create account
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div style={{ flex: "1.15 1 460px", minWidth: 0, display: "flex", flexDirection: "column", gap: 28 }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            For Spotify Premium
          </p>
          <h1>
            Stay in the music.
            <br />
            <span style={{ color: "var(--muted)" }}>Talk can wait.</span>
          </h1>
          <p className="lede" style={{ margin: 0, fontSize: 19, maxWidth: 520 }}>
            OnlySongs quietly watches your Spotify. When a podcast or audiobook starts on your phone, laptop, car or speaker, it slips the
            song you chose back in.
          </p>
          <div className="home-actions">
            <Link className="btn" href="/signup" style={{ minHeight: 52 }}>
              Create an account
            </Link>
            <a className="btn secondary" href="#how" style={{ minHeight: 52 }}>
              See how it works
            </a>
          </div>
          <p className="help" style={{ margin: 0, maxWidth: 480 }}>
            Needs Spotify Premium and a free Spotify developer app. Setup takes a few minutes, and we walk you through every step.
          </p>
        </div>

        <div
          role="img"
          aria-label="A podcast starts, and OnlySongs returns your song"
          className="orb-wrap"
          style={{ flex: "1 1 380px", minWidth: 0, minHeight: 460 }}
        >
          <div className="orb-ring" style={{ width: 380, height: 380 }} />
          <div className="orb" style={{ position: "absolute", width: 360 }} />
          <div style={{ position: "relative", width: "min(320px, 90%)", display: "flex", flexDirection: "column", gap: 10, marginTop: 140 }}>
            <div className="glass row" style={{ padding: "14px 16px", gap: 14, flexWrap: "nowrap" }}>
              <span className="dot apricot" />
              <div style={{ minWidth: 0 }}>
                <div className="help" style={{ fontSize: 13 }}>
                  Podcast started
                </div>
                <div style={{ color: "var(--body)", textDecoration: "line-through", textDecorationColor: "var(--apricot)" }}>An episode you didn’t choose</div>
              </div>
            </div>
            <div className="glass row" style={{ padding: 16, gap: 14, flexWrap: "nowrap", borderColor: "rgba(180,168,245,.45)" }}>
              <span style={{ flex: "none", width: 44, height: 44, borderRadius: 10, background: "#2a2548", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg {...icon} width={20} height={20} strokeWidth={1.8}>
                  <path d="M9 18V6l11-2v12" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="17" cy="16" r="3" />
                </svg>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--accent-text)" }}>Back to your song</div>
                <div style={{ fontWeight: 500 }}>The track you picked</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" aria-labelledby="how-h" className="section">
        <div style={{ maxWidth: 620 }}>
          <p className="eyebrow">How it works</p>
          <h2 id="how-h">Set it once. Then forget it’s there.</h2>
        </div>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 20 }}>
          <li className="step-card">
            <span className="step-num">1</span>
            <h3>Connect your Spotify</h3>
            <p>Create a free Spotify developer app and paste two keys. The guided setup takes you through each step.</p>
          </li>
          <li className="step-card">
            <span className="step-num">2</span>
            <h3>Choose your song</h3>
            <p>Pick a track, playlist or album to come back to. Search Spotify or paste a link.</p>
          </li>
          <li className="step-card">
            <span className="step-num">3</span>
            <h3>Stay in your flow</h3>
            <p>On a timer you set, OnlySongs checks what’s playing. A podcast or audiobook gives way to your song on the same device.</p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="calm-h" className="section" style={{ flexDirection: "row", flexWrap: "wrap", gap: 48, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 340px", minWidth: 0 }}>
          <p className="eyebrow">On your terms</p>
          <h2 id="calm-h">Quiet when you want it. Out of the way when you don’t.</h2>
        </div>
        <div style={{ flex: "1.3 1 420px", minWidth: 0, borderBottom: "1px solid var(--line)" }}>
          <div className="feature-row">
            <svg {...icon} style={{ flex: "none", marginTop: 3 }}>
              <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
            </svg>
            <div>
              <h3>Quiet hours</h3>
              <p>Let podcasts play during the hours you choose, like your evening walk.</p>
            </div>
          </div>
          <div className="feature-row">
            <svg {...icon} style={{ flex: "none", marginTop: 3 }}>
              <path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.5-7 11-7 11z" />
            </svg>
            <div>
              <h3>An allow list</h3>
              <p>Keep the few shows and audiobooks you love. Everything else steps aside.</p>
            </div>
          </div>
          <div className="feature-row">
            <svg {...icon} style={{ flex: "none", marginTop: 3 }}>
              <rect x="3" y="4" width="13" height="10" rx="2" />
              <rect x="15" y="9" width="6" height="11" rx="1.5" />
              <path d="M7 18h5" />
            </svg>
            <div>
              <h3>Every device</h3>
              <p>It works through your Spotify account, so phone, laptop, car and speaker all follow the same rule.</p>
            </div>
          </div>
          <div className="feature-row">
            <svg {...icon} style={{ flex: "none", marginTop: 3 }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <div>
              <h3>Honest about timing</h3>
              <p>
                Spotify doesn’t announce what starts playing, so a podcast can run until the next check. At the default one-minute timer,
                that’s about 30 seconds on average.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="setup" aria-labelledby="setup-h" className="card" style={{ marginBottom: "clamp(72px, 9vw, 120px)", flexDirection: "row", flexWrap: "wrap", gap: 40, alignItems: "center", padding: "clamp(32px, 5vw, 56px)", borderRadius: 32 }}>
        <div style={{ flex: "1.2 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 id="setup-h" style={{ fontWeight: 300, fontSize: "clamp(28px, 3.4vw, 40px)", letterSpacing: "-0.03em" }}>
            What you’ll need
          </h2>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12, color: "var(--body)" }}>
            <li className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 12 }}>
              <span className="dot" style={{ width: 6, height: 6, marginTop: 10 }} aria-hidden="true" />
              Spotify Premium. Spotify only lets apps control playback on Premium accounts.
            </li>
            <li className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 12 }}>
              <span className="dot" style={{ width: 6, height: 6, marginTop: 10 }} aria-hidden="true" />A free app on Spotify’s developer
              dashboard. It belongs to you, and you can revoke it any time.
            </li>
            <li className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 12 }}>
              <span className="dot" style={{ width: 6, height: 6, marginTop: 10 }} aria-hidden="true" />A few minutes. Setup opens Spotify for
              you and gives you everything to copy.
            </li>
          </ul>
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
          <Link className="btn" href="/signup" style={{ minHeight: 52 }}>
            Create an account
          </Link>
          <span className="help" style={{ fontSize: 13 }}>
            Your Spotify keys are encrypted and never shown again.
          </span>
        </div>
      </section>

      <footer className="spread" style={{ padding: "28px 0 44px", borderTop: "1px solid var(--raised)", fontSize: 13, color: "var(--muted)" }}>
        <span>OnlySongs isn’t affiliated with or endorsed by Spotify.</span>
        <span className="mono">onlysongs.io</span>
      </footer>
    </main>
  );
}
