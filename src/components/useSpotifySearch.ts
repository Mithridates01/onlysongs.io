"use client";

import { useEffect, useState } from "react";
import type { SearchHitView } from "@/lib/types";

const DEBOUNCE_MS = 300;

type Kind = "track" | "playlist" | "album" | "show";

// Searches Spotify as the query changes. Waits for a pause in typing, and
// aborts the previous request so a slow response can't overwrite a newer one.
export function useSpotifySearch(kind: Kind, query: string, enabled: boolean, onError: (message: string) => void) {
  const [hits, setHits] = useState<SearchHitView[]>([]);
  const [searching, setSearching] = useState(false);
  const term = query.trim();

  useEffect(() => {
    if (!enabled || term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/spotify/search?type=${kind}&q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { hits?: SearchHitView[]; error?: string };
        if (!response.ok) {
          onError(data.error ?? "Search failed.");
          setHits([]);
        } else {
          onError("");
          setHits(data.hits ?? []);
        }
        setSearching(false);
      } catch {
        // Aborted by a newer query, or the network dropped; the next keystroke retries.
        if (!controller.signal.aborted) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // onError is a setter from the parent; re-running on its identity would refire searches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, term, enabled]);

  return { hits, setHits, searching };
}
