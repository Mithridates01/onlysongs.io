export type PlayerItem = {
  type?: string;
  uri?: string;
  name?: string;
  id?: string;
  show?: { id?: string; name?: string; uri?: string };
  audiobook?: { id?: string; name?: string; uri?: string };
  artists?: { name?: string }[];
  album?: { images?: { url?: string }[] };
  images?: { url?: string }[];
};

export type PlayerBody = {
  is_playing?: boolean;
  currently_playing_type?: string;
  context?: { type?: string; uri?: string } | null;
  device?: { id?: string; name?: string } | null;
  item?: PlayerItem | null;
};

export type BlockRules = {
  blockPodcasts: boolean;
  blockAudiobooks: boolean;
};

export type PlaybackResult =
  | { ok: true; status: 204 }
  | { ok: true; status: 200; body: PlayerBody }
  | { ok: false; status: number; retryAfterSec?: number; reason?: string };

export type BlockTarget = {
  showId?: string;
  showName?: string;
  episodeName?: string;
  deviceId?: string;
  deviceName?: string;
  uri?: string;
  kind: "episode" | "audiobook";
};

export type Classification =
  | { kind: "idle" }
  | { kind: "music" }
  | { kind: "ignored"; content: "episode" | "audiobook" }
  | { kind: "block"; target: BlockTarget };

export type Replacement = {
  uri: string;
  kind: "track" | "playlist" | "album";
};

export function spokenKind(body: PlayerBody): "episode" | "audiobook" | null {
  const item = body.item;
  const uri = item?.uri ?? "";
  const playingType = body.currently_playing_type ?? "";
  const itemType = item?.type ?? "";
  if (playingType === "track" || itemType === "track" || uri.startsWith("spotify:track:")) return null;
  if (isAudiobook(body)) return "audiobook";

  const contextUri = body.context?.uri ?? "";
  const contextType = body.context?.type ?? "";
  const podcast =
    playingType === "episode" ||
    itemType === "episode" ||
    contextType === "show" ||
    uri.startsWith("spotify:episode:") ||
    contextUri.startsWith("spotify:show:") ||
    Boolean(item?.show?.id || item?.show?.uri);
  return podcast ? "episode" : null;
}

function isAudiobook(body: PlayerBody): boolean {
  const item = body.item;
  const uri = item?.uri ?? "";
  const contextUri = body.context?.uri ?? "";
  const playingType = body.currently_playing_type ?? "";
  const itemType = item?.type ?? "";
  const contextType = body.context?.type ?? "";
  return (
    playingType === "chapter" ||
    playingType === "audiobook" ||
    itemType === "chapter" ||
    itemType === "audiobook" ||
    contextType === "audiobook" ||
    uri.startsWith("spotify:chapter:") ||
    uri.startsWith("spotify:audiobook:") ||
    contextUri.startsWith("spotify:audiobook:") ||
    Boolean(item?.audiobook?.id || item?.audiobook?.uri)
  );
}

export function classifyPlayback(result: PlaybackResult, rules: BlockRules): Classification {
  if (!result.ok) return { kind: "idle" };
  if (result.status === 204) return { kind: "idle" };
  const body = result.body;
  if (body.is_playing !== true) return { kind: "idle" };

  const content = spokenKind(body);
  if (!content) return { kind: "music" };
  const enabled = content === "audiobook" ? rules.blockAudiobooks : rules.blockPodcasts;
  if (!enabled) return { kind: "ignored", content };

  const item = body.item;
  const parent = content === "audiobook" ? item?.audiobook : item?.show;
  const showId = parent?.id || showIdFromUri(parent?.uri) || contextId(body.context?.uri, content === "audiobook" ? "audiobook" : "show");

  return {
    kind: "block",
    target: {
      kind: content,
      showId,
      showName: parent?.name,
      episodeName: item?.name,
      deviceId: body.device?.id || undefined,
      deviceName: body.device?.name || undefined,
      uri: item?.uri || undefined,
    },
  };
}

function showIdFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const match = /^spotify:(?:show|audiobook):([A-Za-z0-9]+)$/.exec(uri);
  return match?.[1];
}

function contextId(uri: string | undefined, expected: "show" | "audiobook"): string | undefined {
  if (!uri) return undefined;
  const match = new RegExp(`^spotify:${expected}:([A-Za-z0-9]+)$`).exec(uri);
  return match?.[1];
}

export function playBodyFor(replacement: Replacement): { uris: string[] } | { context_uri: string } {
  if (replacement.kind === "track") return { uris: [replacement.uri] };
  return { context_uri: replacement.uri };
}

export type PlayOutcome = "ok" | "fallback_next" | "error";

export function playOutcome(status: number): PlayOutcome {
  if (status === 200 || status === 202 || status === 204) return "ok";
  if (status === 403 || status === 404) return "fallback_next";
  return "error";
}

export function classifyHttpStatus(
  status: number,
): "empty" | "ok" | "unauthorized" | "restricted_or_missing" | "rate_limited" | "server" | "other" {
  if (status === 204) return "empty";
  if (status === 200 || status === 202) return "ok";
  if (status === 401) return "unauthorized";
  if (status === 403 || status === 404) return "restricted_or_missing";
  if (status === 429) return "rate_limited";
  if (status === 0 || status >= 500) return "server";
  return "other";
}

export function isAllowListed(showId: string | undefined, allowedShowIds: string[]): boolean {
  if (!showId) return false;
  return allowedShowIds.includes(showId);
}

export const COOLDOWN_MS = 15_000;
export const QUOTA_PAUSE_MS = 60 * 60 * 1000;
export const FAILURE_WARN_AT = 10;

export function retryPauseMs(retryAfterSec: number | undefined, quotaExceeded: boolean): number {
  if (quotaExceeded) return QUOTA_PAUSE_MS;
  const seconds = retryAfterSec && retryAfterSec > 0 ? retryAfterSec : 60;
  return seconds * 1000;
}

export function describeNowPlaying(result: PlaybackResult, blocked: boolean): {
  kind: string;
  title: string | null;
  subtitle: string | null;
  art: string | null;
} {
  if (!result.ok || result.status === 204 || result.body.is_playing !== true) {
    return { kind: "none", title: null, subtitle: null, art: null };
  }
  const item = result.body.item;
  const art = item?.album?.images?.[0]?.url || item?.images?.[0]?.url || null;
  const artists = item?.artists?.map((artist) => artist.name).filter(Boolean).join(", ");
  const playingType = result.body.currently_playing_type;
  const spoken = spokenKind(result.body);
  if (spoken || blocked) {
    const kind = spoken ?? "episode";
    return {
      kind,
      title: item?.name ?? (kind === "audiobook" ? "Audiobook" : "Podcast"),
      subtitle: (kind === "audiobook" ? item?.audiobook?.name : item?.show?.name) || null,
      art,
    };
  }
  return {
    kind: playingType || item?.type || "track",
    title: item?.name ?? "Something is playing",
    subtitle: artists || item?.show?.name || null,
    art,
  };
}
