"use client";

import { useState } from "react";
import type { ReplacementView, SearchHitView } from "@/lib/types";

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
  const [hits, setHits] = useState<SearchHitView[]>([]);
  const [paste, setPaste] = useState("");
  const [pending, setPending] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    onError("");
    const response = await fetch(`/api/spotify/search?type=${kind}&q=${encodeURIComponent(query)}`);
    const data = (await response.json()) as { hits?: SearchHitView[]; error?: string };
    if (!response.ok) {
      onError(data.error ?? "Search failed.");
      setHits([]);
      return;
    }
    setHits(data.hits ?? []);
  }

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
      <h2>Replacement</h2>
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
      <form onSubmit={search} className="row">
        <select className="inline-input" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Replacement type">
          <option value="track">Track</option>
          <option value="playlist">Playlist</option>
          <option value="album">Album</option>
        </select>
        <input
          className="inline-input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="Search Spotify"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="btn secondary" type="submit" disabled={!readySpotify}>
          Search
        </button>
      </form>
      <div className="hits">
        {hits.map((hit) => (
          <button key={hit.uri} type="button" className="hit" onClick={() => choose(hit)} disabled={pending}>
            {hit.art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="art sm" src={hit.art} alt="" />
            ) : (
              <div className="art-ph sm" />
            )}
            <span>
              {hit.title}
              <small>{hit.subtitle}</small>
            </span>
          </button>
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
