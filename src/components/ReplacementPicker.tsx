"use client";

import { useState } from "react";
import type { ReplacementView, SearchHitView } from "@/lib/types";
import { SampleButton } from "./SampleButton";
import { useSamplePlayer } from "./useSamplePlayer";
import { useSpotifySearch } from "./useSpotifySearch";

type Props = {
  replacement: ReplacementView | null;
  readySpotify: boolean;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
};

// Search Spotify or paste a link, then save the pick as the replacement.
export function ReplacementPicker({ replacement, readySpotify, onSaved, onError }: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"track" | "playlist" | "album">("track");
  const [paste, setPaste] = useState("");
  const [pending, setPending] = useState(false);
  const { sample, toggle: toggleSample, stop: stopSample } = useSamplePlayer();
  const { hits, setHits, searching } = useSpotifySearch(kind, query, readySpotify, onError);

  async function choose(hit: SearchHitView) {
    if (hit.kind !== "track" && hit.kind !== "playlist" && hit.kind !== "album") return;
    setPending(true);
    onError("");
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
      onError(data.error ?? "Could not save that song.");
      return;
    }
    setHits([]);
    setQuery("");
    stopSample();
    await onSaved();
  }

  async function usePaste(event: React.FormEvent) {
    event.preventDefault();
    onError("");
    setPending(true);
    const resolved = await fetch("/api/spotify/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: paste, purpose: "replacement" }),
    });
    const data = (await resolved.json()) as { hit?: SearchHitView; error?: string };
    setPending(false);
    if (!resolved.ok || !data.hit) {
      onError(data.error ?? "Could not read that link.");
      return;
    }
    setPaste("");
    await choose(data.hit);
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Choose your song</h2>
      {replacement ? (
        <div className="now" style={{ marginBottom: 14 }}>
          {replacement.art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="art" src={replacement.art} alt="" />
          ) : (
            <div className="art-ph" />
          )}
          <div>
            <span className="pill">{replacement.kind}</span>
            <strong style={{ display: "block", marginTop: 6 }}>{replacement.label}</strong>
            <span className="mono">{replacement.uri}</span>
          </div>
        </div>
      ) : (
        <p className="help">Search Spotify, or paste a track, playlist, or album link.</p>
      )}
      <form onSubmit={(event) => event.preventDefault()} className="row" role="search">
        <select className="inline-input" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Replacement type">
          <option value="track">Track</option>
          <option value="playlist">Playlist</option>
          <option value="album">Album</option>
        </select>
        <input
          className="inline-input"
          style={{ flex: 1, minWidth: 180 }}
          type="search"
          placeholder={readySpotify ? "Search Spotify" : "Connect Spotify to search"}
          aria-label="Search Spotify"
          value={query}
          disabled={!readySpotify}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      {searching ? <p className="help" aria-live="polite">Searching…</p> : null}
      <div className="hits">
        {hits.map((hit) => (
          <div key={hit.uri} className="hit-row">
            {hit.art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="art sm" src={hit.art} alt="" />
            ) : (
              <div className="art-ph sm" />
            )}
            <SampleButton
              title={hit.title}
              active={sample.uri === hit.uri}
              playing={sample.uri === hit.uri && sample.playing}
              loading={sample.uri === hit.uri && sample.loading}
              progress={sample.progress}
              onToggle={() => void toggleSample(hit.uri)}
            />
            <button type="button" className="hit-pick" onClick={() => choose(hit)} disabled={pending} title="Use this song">
              {hit.title}
              <small>{hit.subtitle}</small>
            </button>
          </div>
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
  );
}
