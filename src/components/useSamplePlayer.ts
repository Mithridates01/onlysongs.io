"use client";

import { useCallback, useEffect, useState } from "react";

// Spotify's Web API returns no preview_url for new developer apps, so samples
// play through Spotify's embed player. One hidden embed is shared by the page
// and driven through the iFrame API, which reports playback position.
// https://developer.spotify.com/documentation/embeds/references/iframe-api

type PlaybackUpdate = { data: { isPaused: boolean; isBuffering: boolean; duration: number; position: number } };

type EmbedController = {
  loadUri: (uri: string) => void;
  play: () => void;
  pause: () => void;
  resume: () => void;
  addListener: (event: "playback_update", callback: (event: PlaybackUpdate) => void) => void;
};

type IFrameApi = {
  createController: (
    element: HTMLElement,
    options: { uri: string; width: number; height: number },
    callback: (controller: EmbedController) => void,
  ) => void;
};

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: IFrameApi) => void;
  }
}

const API_SRC = "https://open.spotify.com/embed/iframe-api/v1";

let controllerPromise: Promise<EmbedController> | null = null;
const listeners = new Set<(event: PlaybackUpdate) => void>();

function loadController(firstUri: string): Promise<EmbedController> {
  controllerPromise ??= new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = (api) => {
      const host = document.createElement("div");
      const frame = document.createElement("div");
      host.className = "sample-host";
      host.setAttribute("aria-hidden", "true");
      host.appendChild(frame);
      document.body.appendChild(host);
      api.createController(frame, { uri: firstUri, width: 300, height: 80 }, (controller) => {
        controller.addListener("playback_update", (event) => listeners.forEach((listener) => listener(event)));
        resolve(controller);
      });
      // The API marks its iframe lazy, and an off-screen lazy iframe never loads.
      host.querySelector("iframe")?.setAttribute("loading", "eager");
    };
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => {
      controllerPromise = null;
      reject(new Error("Could not load the Spotify player."));
    };
    document.body.appendChild(script);
  });
  return controllerPromise;
}

export type SampleState = { uri: string | null; playing: boolean; loading: boolean; progress: number };

// Play or pause one sample at a time. progress runs from 0 to 1.
export function useSamplePlayer() {
  const [state, setState] = useState<SampleState>({ uri: null, playing: false, loading: false, progress: 0 });

  useEffect(() => {
    const listener = ({ data }: PlaybackUpdate) => {
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
      controllerPromise?.then((controller) => controller.pause()).catch(() => undefined);
    };
  }, []);

  const toggle = useCallback(
    async (uri: string) => {
      const same = state.uri === uri;
      if (same && state.playing) {
        (await loadController(uri)).pause();
        setState((current) => ({ ...current, playing: false }));
        return;
      }
      setState({ uri, playing: false, loading: true, progress: same ? state.progress : 0 });
      try {
        const controller = await loadController(uri);
        if (same && state.progress > 0) {
          controller.resume();
        } else {
          controller.loadUri(uri);
          controller.play();
        }
      } catch {
        setState({ uri: null, playing: false, loading: false, progress: 0 });
      }
    },
    [state],
  );

  const stop = useCallback(() => {
    controllerPromise?.then((controller) => controller.pause()).catch(() => undefined);
    setState({ uri: null, playing: false, loading: false, progress: 0 });
  }, []);

  return { sample: state, toggle, stop };
}
