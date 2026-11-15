"use client";

import { useCallback, useEffect, useState } from "react";

// Spotify's Web API returns no preview_url for new developer apps, so samples
// play through Spotify's embed player. One hidden embed iframe is shared by the
// page and driven by postMessage, the protocol Spotify's iFrame API wraps:
// https://developer.spotify.com/documentation/embeds/references/iframe-api
// The iFrame API script itself is not loaded: it ships as an eval-based
// development build, which the site's CSP (no 'unsafe-eval') refuses.

const SPOTIFY_ORIGIN = "https://open.spotify.com";

type PlaybackPayload = { isPaused: boolean; isBuffering: boolean; duration: number; position: number };
type EmbedMessage = { type?: string; payload?: PlaybackPayload };
type Command = "play" | "pause" | "resume" | "load_complete_ack";

type Embed = {
  frame: HTMLIFrameElement;
  uri: string | null;
  ready: boolean;
  queue: Command[];
};

let embed: Embed | null = null;
const listeners = new Set<(payload: PlaybackPayload) => void>();

function getEmbed(): Embed {
  if (embed) return embed;
  const host = document.createElement("div");
  host.className = "sample-host";
  host.setAttribute("aria-hidden", "true");
  const frame = document.createElement("iframe");
  frame.title = "Spotify sample player";
  frame.width = "300";
  frame.height = "80";
  frame.allow = "autoplay; encrypted-media";
  frame.tabIndex = -1;
  host.appendChild(frame);
  document.body.appendChild(host);
  const created: Embed = { frame, uri: null, ready: false, queue: [] };
  window.addEventListener("message", (event: MessageEvent<EmbedMessage>) => {
    if (event.origin !== SPOTIFY_ORIGIN || event.source !== created.frame.contentWindow) return;
    if (event.data?.type === "ready") {
      created.ready = true;
      send(created, "load_complete_ack");
      created.queue.splice(0).forEach((command) => send(created, command));
    } else if (event.data?.type === "playback_update" && event.data.payload) {
      const payload = event.data.payload;
      listeners.forEach((listener) => listener(payload));
    }
  });
  embed = created;
  return created;
}

function send(target: Embed, command: Command) {
  if (!target.ready && command !== "load_complete_ack") {
    target.queue.push(command);
    return;
  }
  target.frame.contentWindow?.postMessage({ command }, SPOTIFY_ORIGIN);
}

// Points the embed at a track, album or playlist, then plays once it's ready.
function loadAndPlay(target: Embed, uri: string) {
  const [, type, id] = uri.split(":");
  if (!type || !id) return;
  target.uri = uri;
  target.ready = false;
  target.queue = ["play"];
  target.frame.src = `${SPOTIFY_ORIGIN}/embed/${encodeURIComponent(type)}/${encodeURIComponent(id)}?utm_source=iframe-api`;
}

export type SampleState = { uri: string | null; playing: boolean; loading: boolean; progress: number };

// Play or pause one sample at a time. progress runs from 0 to 1.
export function useSamplePlayer() {
  const [state, setState] = useState<SampleState>({ uri: null, playing: false, loading: false, progress: 0 });

  useEffect(() => {
    const listener = (data: PlaybackPayload) => {
      setState((current) => {
        if (!current.uri) return current;
        const progress = data.duration > 0 ? Math.min(1, data.position / data.duration) : 0;
        // The embed reports paused at position 0 before a new track starts, so only
        // a pause after playback began ends loading.
        const started = data.position > 0 || !data.isPaused;
        const ended = data.isPaused && progress >= 0.99;
        return {
          uri: current.uri,
          playing: !data.isPaused && !ended,
          loading: current.loading && !started,
          progress: ended ? 0 : started ? progress : current.progress,
        };
      });
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (embed) send(embed, "pause");
    };
  }, []);

  const toggle = useCallback(
    (uri: string) => {
      const target = getEmbed();
      const same = state.uri === uri && target.uri === uri;
      if (same && state.playing) {
        send(target, "pause");
        setState((current) => ({ ...current, playing: false }));
        return;
      }
      setState({ uri, playing: false, loading: true, progress: same ? state.progress : 0 });
      if (same) send(target, state.progress > 0 ? "resume" : "play");
      else loadAndPlay(target, uri);
    },
    [state],
  );

  const stop = useCallback(() => {
    if (embed) send(embed, "pause");
    setState({ uri: null, playing: false, loading: false, progress: 0 });
  }, []);

  return { sample: state, toggle, stop };
}
