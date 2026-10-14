import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await currentSession();
  if (session) redirect("/dashboard");

  return (
    <main className="app">
      <p className="mono">Self-hosted · Spotify Premium</p>
      <h1 className="page-title">A song takes the speaker when a podcast starts.</h1>
      <p className="lede">
        This app watches your Spotify account from a server you run. If an episode is playing on your phone, laptop,
        car, or speaker, it swaps in a track, playlist, or album you picked ahead of time.
      </p>
      <div className="home-actions">
        <Link className="btn" href="/signup">
          Create account
        </Link>
        <Link className="btn secondary" href="/login">
          Sign in
        </Link>
      </div>
      <div className="grid two" style={{ marginTop: 28 }}>
        <section className="card">
          <h2>How a check works</h2>
          <ol className="steps">
            <li>Every minute, the server asks Spotify what is playing.</li>
            <li>A song, a pause, or silence is left alone.</li>
            <li>A podcast episode is replaced on the same device.</li>
            <li>Audiobooks can be blocked too. Quiet hours and an allow list opt shows back in.</li>
          </ol>
        </section>
        <section className="card">
          <h2>What you need</h2>
          <p>Spotify Premium, and your own app from the Spotify developer dashboard. The setup screen gives you the redirect URI to paste.</p>
          <p className="help">A podcast can play until the next check. At the default 60 seconds, that is about half a minute.</p>
        </section>
      </div>
    </main>
  );
}
